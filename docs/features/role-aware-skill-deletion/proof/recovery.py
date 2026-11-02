from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from backend.app.config import Settings
from backend.app.git_export import GitExportError
from backend.app.installation import InstallationPolicy
from backend.app.main import create_app
from backend.app.repository import RegistryRepository


class FailingExporter:
    def __init__(self, delegate) -> None:
        self.delegate = delegate

    def export(self, _versions: list[dict], *, message: str) -> str:
        del message
        raise GitExportError("Injected deletion export failure.")

    def __getattr__(self, name: str):
        return getattr(self.delegate, name)


def payload(slug: str) -> dict:
    return {
        "slug": slug,
        "name": slug.replace("-", " ").title(),
        "description": "Pending deletion recovery fixture.",
        "files": {"SKILL.md": f"---\nname: {slug}\n---\n\n# Recovery\n"},
    }


def build(root: Path):
    public_url = "http://127.0.0.1:4261"
    settings = Settings(
        database_path=root / "registry.sqlite3",
        git_dir=root / "registry-git",
        public_url=public_url,
    )
    repository = RegistryRepository(settings.database_path)
    repository.initialize()
    if repository.installation_config() is None:
        repository.create_installation_config(
            InstallationPolicy.open(public_url).record()
        )
    app = create_app(settings, require_setup=True)
    app.config["TESTING"] = True
    return app, settings


def pending_count(database_path: Path) -> int:
    connection = sqlite3.connect(database_path)
    count = connection.execute("SELECT COUNT(*) FROM skill_deletions").fetchone()[0]
    connection.close()
    return count


state_root = Path(os.environ["PROOF_STATE_DIR"])
state_root.mkdir(parents=True)

sync_root = state_root / "explicit-sync"
sync_root.mkdir()
app, settings = build(sync_root)
service = app.extensions["registry_service"]
service.create_skill(payload("sync-delete"))
service.exporter = FailingExporter(service.exporter)
client = app.test_client()
response = client.delete(
    "/skills/sync-delete", headers={"Origin": settings.public_url}
)
assert response.status_code == 200
assert response.get_json()["git_export"]["status"] == "pending"
assert client.get("/skills/sync-delete").status_code == 404
assert client.get("/health").get_json()["pending_git_exports"] == 1
assert pending_count(settings.database_path) == 1
service.exporter = service.exporter.delegate
service.synchronize_git()
assert client.get("/health").get_json()["pending_git_exports"] == 0
assert pending_count(settings.database_path) == 0
assert not (settings.git_dir / "skills/sync-delete").exists()

restart_root = state_root / "startup"
restart_root.mkdir()
app, settings = build(restart_root)
service = app.extensions["registry_service"]
service.create_skill(payload("restart-delete"))
service.exporter = FailingExporter(service.exporter)
client = app.test_client()
response = client.delete(
    "/skills/restart-delete", headers={"Origin": settings.public_url}
)
assert response.status_code == 200
assert pending_count(settings.database_path) == 1
restarted, _settings = build(restart_root)
assert restarted.test_client().get("/health").get_json()["pending_git_exports"] == 0
assert pending_count(settings.database_path) == 0
assert not (settings.git_dir / "skills/restart-delete").exists()

missing = restarted.test_client().delete(
    "/skills/never-present", headers={"Origin": settings.public_url}
)
assert missing.status_code == 404
assert pending_count(settings.database_path) == 0
print("Pending deletion recovery verified: explicit sync and startup reconciliation")
