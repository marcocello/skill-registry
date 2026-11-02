from __future__ import annotations

import os
from pathlib import Path

from werkzeug.serving import make_server

from backend.app.config import Settings
from backend.app.installation import InstallationPolicy
from backend.app.main import create_app
from backend.app.repository import RegistryRepository


MODE = os.environ["PROOF_MODE"]
PORT = int(os.environ["PROOF_BACKEND_PORT"])
FRONTEND_URL = os.environ["PROOF_FRONTEND_URL"]
STATE_DIR = Path(os.environ["PROOF_STATE_DIR"])


def payload(slug: str) -> dict:
    label = slug.replace("-", " ").title()
    return {
        "slug": slug,
        "name": label,
        "description": f"Proof fixture for {label}.",
        "files": {"SKILL.md": f"---\nname: {slug}\n---\n\n# {label}\n"},
    }


def proof_verifier(token: str, nonce: str) -> dict:
    personas = {
        "proof-user": ("user@proof.test", "Proof User"),
        "proof-admin": ("admin@proof.test", "Proof Admin"),
    }
    email, name = personas[token]
    return {
        "iss": "https://accounts.google.com",
        "sub": token,
        "aud": "proof-client",
        "email": email,
        "email_verified": True,
        "hd": "proof.test",
        "name": name,
        "nonce": nonce,
    }


database_path = STATE_DIR / "registry.sqlite3"
git_dir = STATE_DIR / "registry-git"
settings = Settings(
    database_path=database_path,
    git_dir=git_dir,
    public_url=FRONTEND_URL,
    google_client_id="proof-client",
    google_client_secret="proof-secret",
    allowed_google_domains=("proof.test",),
    admin_emails=("admin@proof.test",),
)
repository = RegistryRepository(database_path)
repository.initialize()
policy = (
    InstallationPolicy.open(FRONTEND_URL)
    if MODE == "open"
    else InstallationPolicy.from_settings(settings)
)
repository.create_installation_config(policy.record())
app = create_app(
    settings,
    require_setup=True,
    oidc_verifier=proof_verifier,
    oidc_exchange=lambda code: {"id_token": code},
)
service = app.extensions["registry_service"]
slugs = (
    ("list-delete-one", "list-delete-two", "detail-delete")
    if MODE == "open"
    else ("protected-skill", "admin-list-delete", "admin-detail-delete")
)
for slug in slugs:
    service.create_skill(payload(slug))
if MODE == "open":
    service.update_skill("list-delete-one", payload("list-delete-one"))
else:
    service.update_skill("admin-list-delete", payload("admin-list-delete"))

server = make_server("127.0.0.1", PORT, app, threaded=True)
server.serve_forever()
