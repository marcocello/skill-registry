"""Production-Compose proof for the OIDC-only Registry boundary.

The first assertion deliberately crosses Nginx before any test-only identity setup. It
therefore supplies a meaningful red against the legacy public catalogue and remains a
guard against accidentally restoring public/fallback access.
"""

from __future__ import annotations

import json
import hashlib
import os
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
COMPOSE_FILE = REPO_ROOT / "deployment" / "prod" / "compose.yaml"
EMPTY_ENV = Path(__file__).with_name("empty.env")


def _port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request(url: str, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read()
            return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body else {}


def _wait_health(frontend: str) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            status, _body = _request(f"{frontend}/api/health")
            if status == 200:
                return
        except OSError:
            pass
        time.sleep(1)
    raise AssertionError("production frontend/backend gateway did not become ready")


def _seed_legacy_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE skills (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, description TEXT, latest_version INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE skill_versions (id INTEGER PRIMARY KEY, skill_id INTEGER, version INTEGER, name TEXT, description TEXT, files_json TEXT, content_hash TEXT, created_at TEXT, git_export_status TEXT, git_commit_sha TEXT, git_export_error TEXT, UNIQUE(skill_id, version));
        CREATE TABLE access_tokens (id TEXT PRIMARY KEY, name TEXT, token_hash TEXT, token_prefix TEXT, created_at TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT);
        CREATE INDEX access_tokens_token_hash_idx ON access_tokens(token_hash);
        """
    )
    files = {"SKILL.md": "---\nname: proof-existing\n---\n\n# Preserved by OIDC migration\n"}
    connection.execute("INSERT INTO skills VALUES (1, 'proof-existing', 'Proof Existing', 'Migration sentinel', 1, '2026-01-01', '2026-01-01')")
    connection.execute(
        "INSERT INTO skill_versions VALUES (1, 1, 1, 'Proof Existing', 'Migration sentinel', ?, ?, '2026-01-01', 'pending', NULL, NULL)",
        (json.dumps(files), hashlib.sha256(b"proof-existing").hexdigest()),
    )
    connection.execute("INSERT INTO access_tokens VALUES ('legacy', 'Legacy', ?, 'sr_legacy', '2026', NULL, NULL, NULL)", (hashlib.sha256(b"sr_legacy").hexdigest(),))
    connection.commit()
    connection.close()


def _compose(
    project: str,
    override: Path,
    *arguments: str,
    check: bool = True,
    project_directory: Path | None = None,
    base_file: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    command = [
        "docker",
        "compose",
        "--env-file",
        str(EMPTY_ENV),
        "-p",
        project,
        "-f",
        str(base_file or COMPOSE_FILE),
        "-f",
        str(override),
    ]
    if project_directory is not None:
        command.extend(["--project-directory", str(project_directory)])
    command.extend(arguments)
    result = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env={**os.environ, "COMPOSE_DISABLE_ENV_FILE": "1"},
        check=False,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"Compose failed ({result.returncode}):\n{result.stdout}\n{result.stderr}"
        )
    return result


def _fixture_compose(
    project: str, fixture: Path, *arguments: str, check: bool = True
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(EMPTY_ENV),
            "-p",
            project,
            "-f",
            str(fixture),
            *arguments,
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "COMPOSE_DISABLE_ENV_FILE": "1"},
        check=False,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"fixture Compose failed ({result.returncode}):\n{result.stdout}\n{result.stderr}"
        )
    return result


def _assert_static_configuration(config: str) -> None:
    compose_source = COMPOSE_FILE.read_text()
    forbidden = [
        "SKILLS_REGISTRY_",
        "VITE_SKILLS_REGISTRY_",
        "env_file:",
        "${",
        "ADMIN_PASSWORD",
    ]
    for marker in forbidden:
        assert marker not in compose_source, f"legacy Compose marker remains: {marker}"
    assert "ALLOWED_GOOGLE_DOMAINS: example.com" in compose_source
    assert "ADMIN_EMAILS: admin@example.com" in compose_source
    assert "DATABASE_PATH: /workspace/registry.sqlite3" in compose_source
    assert "GIT_REPOSITORY_PATH: /workspace/registry-git" in compose_source
    assert compose_source.count("- ./workspace:/workspace") == 1
    assert "storage-init" not in compose_source
    assert "x-storage-paths" not in compose_source
    assert "DATABASE_HOST_PATH" not in compose_source
    assert "GIT_REPOSITORY_HOST_PATH" not in compose_source
    assert "GIT_DIR:" not in compose_source
    assert "\nvolumes:\n" not in compose_source
    assert "workspace/" in (REPO_ROOT / ".gitignore").read_text()
    for dockerignore in (
        REPO_ROOT / "backend" / ".dockerignore",
        REPO_ROOT / "frontend" / ".dockerignore",
    ):
        assert "workspace" in dockerignore.read_text()
    subprocess.run(
        [
            "git",
            "check-ignore",
            "--no-index",
            "workspace/registry.sqlite3",
            "workspace/registry-git/.git/HEAD",
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "GOOGLE_CLIENT_SECRET" in config
    frontend = config.split("frontend:", 1)[-1]
    assert "GOOGLE_CLIENT_SECRET" not in frontend, "Google secret reached frontend config"


def _assert_legacy_surfaces_absent() -> None:
    source = "\n".join(
        path.read_text(errors="replace")
        for root in (REPO_ROOT / "backend", REPO_ROOT / "frontend" / "app" / "src")
        for path in root.rglob("*")
        if path.is_file() and path.suffix in {".py", ".ts", ".tsx"}
    )
    for marker in (
        "/auth/admin/session",
        "/admin/access-tokens",
        "skills.create",
        "skills.update",
        "bearer-token-env-var",
        "Get an access token",
    ):
        assert marker not in source, f"legacy surface remains: {marker}"
    assert not (REPO_ROOT / "backend" / "app" / "access.py").exists()


def _assert_single_workspace_lifecycle(root: Path) -> None:
    project = f"skills-registry-workspace-proof-{uuid.uuid4().hex[:10]}"
    project_root = root / "single-workspace-project"
    project_root.mkdir()
    workspace = project_root / "workspace"
    assert not workspace.exists()
    backend_port = _port()
    base_file = project_root / "compose.yaml"
    base_file.write_text(COMPOSE_FILE.read_text())
    override = project_root / "compose.override.yaml"
    override.write_text(
        f"""services:
  backend:
    build:
      context: {REPO_ROOT}
      dockerfile: backend/Dockerfile
    ports: !override
      - 127.0.0.1:{backend_port}:8000
  frontend:
    build:
      context: {REPO_ROOT / "frontend"}
      dockerfile: Dockerfile
"""
    )
    resolved = json.loads(
        _compose(
            project,
            override,
            "config",
            "--format",
            "json",
            project_directory=project_root,
            base_file=base_file,
        ).stdout
    )
    backend_volumes = resolved["services"]["backend"]["volumes"]
    assert len(backend_volumes) == 1
    assert backend_volumes[0]["source"] == str(workspace)
    assert backend_volumes[0]["target"] == "/workspace"
    try:
        _compose(
            project,
            override,
            "up",
            "--build",
            "--detach",
            "--wait",
            "backend",
            project_directory=project_root,
            base_file=base_file,
        )
        _compose(
            project,
            override,
            "exec",
            "-T",
            "backend",
            "test",
            "-f",
            "/workspace/registry.sqlite3",
            project_directory=project_root,
            base_file=base_file,
        )
        _compose(
            project,
            override,
            "exec",
            "-T",
            "backend",
            "test",
            "-d",
            "/workspace/registry-git/.git",
            project_directory=project_root,
            base_file=base_file,
        )
        _compose(
            project,
            override,
            "exec",
            "-T",
            "backend",
            "python",
            "-c",
            (
                "from pathlib import Path; "
                "Path('/workspace/database.marker').write_text('database-v1'); "
                "Path('/workspace/registry-git/persistence.marker').write_text('git-v1')"
            ),
            project_directory=project_root,
            base_file=base_file,
        )
        _compose(
            project,
            override,
            "down",
            "--volumes",
            "--remove-orphans",
            project_directory=project_root,
            base_file=base_file,
        )
        _compose(
            project,
            override,
            "up",
            "--detach",
            "--wait",
            "backend",
            project_directory=project_root,
            base_file=base_file,
        )
        readback = _compose(
            project,
            override,
            "exec",
            "-T",
            "backend",
            "python",
            "-c",
            (
                "from pathlib import Path; "
                "print(Path('/workspace/database.marker').read_text()); "
                "print(Path('/workspace/registry-git/persistence.marker').read_text())"
            ),
            project_directory=project_root,
            base_file=base_file,
        ).stdout.splitlines()
        assert readback == ["database-v1", "git-v1"]
    finally:
        _compose(
            project,
            override,
            "down",
            "--volumes",
            "--remove-orphans",
            check=False,
            project_directory=project_root,
            base_file=base_file,
        )


def main() -> None:
    project = f"skills-registry-oidc-proof-{uuid.uuid4().hex[:10]}"
    backend_port = _port()
    frontend_port = _port()
    provider_port = _port()
    frontend = f"http://127.0.0.1:{frontend_port}"
    with tempfile.TemporaryDirectory(prefix="registry-oidc-proof-") as directory:
        root = Path(directory)
        workspace = root / "workspace"
        git_dir = workspace / "registry-git"
        workspace.mkdir()
        git_dir.mkdir()
        _seed_legacy_database(workspace / "registry.sqlite3")
        override = root / "compose.override.yaml"
        override.write_text(
            f"""services:
  backend:
    environment:
      DATABASE_PATH: /workspace/registry.sqlite3
      GIT_REPOSITORY_PATH: /workspace/registry-git
      HOST: 0.0.0.0
      PORT: 8000
      PUBLIC_URL: {frontend}
      GOOGLE_CLIENT_ID: proof-client
      GOOGLE_CLIENT_SECRET: proof-secret-canary
      ALLOWED_GOOGLE_DOMAINS: example.com
      ADMIN_EMAILS: admin@example.com
      GOOGLE_ISSUER: http://fake-google:9000
      GOOGLE_AUTHORIZATION_ENDPOINT: http://127.0.0.1:{provider_port}/authorize
      GOOGLE_TOKEN_ENDPOINT: http://fake-google:9000/token
      GOOGLE_JWKS_URL: http://fake-google:9000/jwks
    ports: !override
      - 127.0.0.1:{backend_port}:8000
    volumes: !override
      - {workspace}:/workspace
  frontend:
    ports: !override
      - 127.0.0.1:{frontend_port}:80
  fake-google:
    build:
      context: {REPO_ROOT}
      dockerfile: backend/Dockerfile
    command: python /proof/fake_google.py
    environment:
      PROOF_GOOGLE_ISSUER: http://fake-google:9000
      PROOF_GOOGLE_CLIENT_ID: proof-client
      PROOF_GOOGLE_CLIENT_SECRET: proof-secret-canary
    ports:
      - 127.0.0.1:{provider_port}:9000
    volumes:
      - {Path(__file__).parent}:/proof:ro
"""
        )
        print(
            f"runtime compose_project={project} frontend={frontend} fake=google-outer-edge-only",
            flush=True,
        )
        try:
            _compose(project, override, "up", "--build", "--detach", "--wait")
            _wait_health(frontend)

            # Real boundary red against the legacy implementation: catalogue data must
            # never be public, even when it is empty.
            status, body = _request(f"{frontend}/api/skills")
            assert status == 401, f"unauthenticated catalogue leaked: HTTP {status} {body}"

            status, _body = _request(f"{frontend}/api/proposals")
            assert status == 401
            status, _body = _request(f"{frontend}/api/auth/admin/session", "POST", {})
            assert status == 404

            config = _compose(project, override, "config").stdout
            _assert_static_configuration(config)
            _assert_legacy_surfaces_absent()

            # The remaining identity, proposal, browser, and MCP OAuth behavior is
            # exercised by the focused regression suite against the same application
            # modules. The Compose assertions above independently fix the deployment
            # and public gateway boundary.
            subprocess.run(
                [
                    ".venv/bin/python",
                    "-m",
                    "pytest",
                    "-p",
                    "no:cacheprovider",
                    "tests/test_oidc_registry.py",
                ],
                cwd=REPO_ROOT,
                check=True,
                timeout=120,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            subprocess.run(
                ["node", "docs/features/google-oidc-registry-access/proof/ui.mjs"],
                cwd=REPO_ROOT,
                check=True,
                timeout=120,
                env={
                    **os.environ,
                    "PROOF_FRONTEND_URL": frontend,
                    "PROOF_PROVIDER_URL": f"http://127.0.0.1:{provider_port}",
                },
            )
            assert (
                git_dir / "skills/mcp-production-pending/references/proof.md"
            ).read_text() == "# Complete contributor bundle\n"
            assert (
                git_dir / "skills/browser-reviewed/scripts/check.sh"
            ).read_text() == "#!/usr/bin/env bash\necho admin-reviewed\n"
            exported = json.loads((git_dir / "registry.json").read_text())
            published = next(
                skill for skill in exported["skills"]
                if skill["slug"] == "mcp-production-pending"
            )
            assert published["owner"]["email"] == "user@example.com"
            latest_manifest = json.loads(
                (git_dir / "skills/mcp-production-pending.json").read_text()
            )
            assert latest_manifest["author"]["email"] == "contributor@example.com"
            with sqlite3.connect(workspace / "registry.sqlite3") as connection:
                owner_email, author_email = connection.execute(
                    """
                    SELECT owner.email, author.email
                    FROM skills s
                    JOIN users owner ON owner.id = s.owner_user_id
                    JOIN skill_versions v
                      ON v.skill_id = s.id AND v.version = s.latest_version
                    JOIN users author ON author.id = v.author_user_id
                    WHERE s.slug = 'mcp-production-pending'
                    """
                ).fetchone()
            assert owner_email == "user@example.com"
            assert author_email == "contributor@example.com"
            logs = _compose(project, override, "logs", "--no-color").stdout
            assert "proof-secret-canary" not in logs
        finally:
            _compose(
                project,
                override,
                "down",
                "--volumes",
                "--remove-orphans",
                check=False,
            )
            _assert_single_workspace_lifecycle(root)
        print(
            "storage workspace=single-bind clean-start=pass recreate=pass persistence=pass",
            flush=True,
        )
        print(
            "PASS: oidc-only=pass roles=pass proposals=pass mcp-oauth=pass migration=pass chromium=pass storage=pass",
            flush=True,
        )


if __name__ == "__main__":
    main()
