from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit

from backend.app.config import Settings
from backend.app.git_remote import GitRemoteManager
from backend.app.installation import InstallationPolicy
from backend.app.main import create_app
from backend.app.repository import RegistryRepository


ROOT = Path(__file__).resolve().parents[4]


def command(args: list[str], *, env: dict[str, str], check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        args, cwd=ROOT, env=env, text=True, capture_output=True,
        check=False, timeout=300,
    )
    if check and completed.returncode != 0:
        raise AssertionError(
            f"Command failed ({completed.returncode}): {' '.join(args)}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return completed


def request(base: str, path: str, *, method: str = "GET", body: dict | None = None, origin: bool = False) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if origin:
        headers["Origin"] = base
    candidate = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(candidate, timeout=10) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def setup_status_response(base: str) -> tuple[int, dict, str]:
    candidate = urllib.request.Request(
        base + "/api/setup/status", headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(candidate, timeout=10) as response:
        return (
            response.status,
            json.loads(response.read() or b"{}"),
            response.headers.get("Cache-Control", ""),
        )


def free_port() -> int:
    return 20000 + os.getpid() % 20000


def setup_payload(origin: str, name: str) -> dict:
    return {
        "auth_mode": "none",
        "public_url": origin,
        "git_repository": {"name": name},
    }


def prove_host_workspace_validation(temp: Path) -> None:
    previous = os.environ.get("HOST_WORKSPACE_PATH")
    try:
        for value in (
            None, "workspace", "/", "/tmp/bad\npath",
            "/tmp/bad\x7fpath", "/tmp/bad\u0085path",
        ):
            if value is None:
                os.environ.pop("HOST_WORKSPACE_PATH", None)
            else:
                os.environ["HOST_WORKSPACE_PATH"] = value
            try:
                Settings.from_environment()
            except ValueError:
                pass
            else:
                raise AssertionError(f"Invalid host workspace path was accepted: {value!r}")
        os.environ["HOST_WORKSPACE_PATH"] = f"{temp}/validated-workspace///"
        assert Settings.from_environment().host_workspace_path == (
            temp / "validated-workspace"
        ).resolve()
    finally:
        if previous is None:
            os.environ.pop("HOST_WORKSPACE_PATH", None)
        else:
            os.environ["HOST_WORKSPACE_PATH"] = previous
    print("host workspace metadata=absolute normalized invalid=denied")


def prove_repository_boundaries(temp: Path) -> None:
    root = temp / "repository-boundaries"
    root.mkdir()
    origin = "http://127.0.0.1:5174"
    settings = Settings(
        database_path=root / "registry.sqlite3", git_dir=root / "legacy-default",
        public_url=origin, google_client_id="", google_client_secret="",
        allowed_google_domains=(), admin_emails=(),
    )
    app = create_app(settings, require_setup=True)
    app.config["TESTING"] = True
    client = app.test_client()
    outside = temp / "outside-repository"
    outside.mkdir()
    (root / "escape-link").symlink_to(outside, target_is_directory=True)
    occupied = root / "occupied"
    occupied.mkdir()
    (occupied / "keep.txt").write_text("must survive\n")
    hidden = root / "hidden-content"
    hidden.mkdir()
    (hidden / ".keep").write_text("must survive\n")

    invalid = [
        "/tmp/outside", "../escape", ".hidden", "nested/name", "trailing-",
        "git-credentials", "GIT-CREDENTIALS", "registry.sqlite3",
        "REGISTRY.SQLITE3", "escape-link", "occupied", "hidden-content",
    ]
    for name in invalid:
        response = client.post(
            "/setup", json=setup_payload(origin, name), headers={"Origin": origin},
        )
        assert response.status_code == 400, (name, response.get_json())
    obsolete = setup_payload(origin, "obsolete")
    obsolete["git_repository"] = {"mode": "existing", "path": "occupied"}
    assert client.post(
        "/setup", json=obsolete, headers={"Origin": origin},
    ).status_code == 400
    assert (occupied / "keep.txt").read_text() == "must survive\n"
    assert (hidden / ".keep").read_text() == "must survive\n"
    assert (root / "escape-link").is_symlink()
    invalid_remote = setup_payload(origin, "retry-new")
    invalid_remote["git_remote"] = {
        "transport": "https", "remote_url": "http://git.example/org/repository.git",
        "branch": "skills-registry", "username": "registry", "token": "retry-secret-canary",
    }
    rejected = client.post("/setup", json=invalid_remote, headers={"Origin": origin})
    assert rejected.status_code == 400
    assert not (root / "retry-new").exists()
    accepted = client.post(
        "/setup", json=setup_payload(origin, "retry-new"), headers={"Origin": origin},
    )
    assert accepted.status_code == 201 and accepted.get_json()["git_repository_path"] == "retry-new"
    assert (root / "retry-new/.git").is_dir()
    assert not (root / "legacy-default").exists()

    legacy_root = temp / "legacy-finalized-path"
    legacy_root.mkdir()
    legacy_git = legacy_root / "nested/legacy-repository"
    legacy_git.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(legacy_git)], check=True)
    legacy_settings = Settings(
        database_path=legacy_root / "registry.sqlite3",
        git_dir=legacy_root / "legacy-default",
        public_url=origin,
        google_client_id="",
        google_client_secret="",
        allowed_google_domains=(),
        admin_emails=(),
    )
    legacy_repository = RegistryRepository(legacy_settings.database_path)
    legacy_repository.initialize()
    legacy_repository.create_installation_config(
        InstallationPolicy.open(origin).record(),
        git_repository_path="nested/legacy-repository",
    )
    legacy_app = create_app(legacy_settings, require_setup=True)
    assert legacy_app.test_client().get("/setup/status").get_json() == {"configured": True}
    assert legacy_app.extensions["registry_runtime"].git_dir == legacy_git.resolve()
    print(
        "repository boundaries=new-only invalid-remote=correctable "
        "same-provisional=reused unsafe=denied legacy-finalized=preserved"
    )


def prove_concurrent_setup_sealing(temp: Path) -> None:
    root = temp / "concurrent-setup-boundary"
    root.mkdir()
    origin = "http://127.0.0.1:5174"
    settings = Settings(
        database_path=root / "registry.sqlite3", git_dir=root / "legacy-default",
        public_url=origin, google_client_id="", google_client_secret="",
        allowed_google_domains=(), admin_emails=(),
    )
    app = create_app(settings, require_setup=True)
    app.config["TESTING"] = True
    repository = app.extensions["registry_repository"]
    original_save = repository.save_setup_config
    original_clear = GitRemoteManager.clear_credentials
    winner_saved = threading.Event()
    release_winner = threading.Event()
    loser_cleared = threading.Event()
    responses: dict[str, int] = {}

    def blocking_save(row: dict, **kwargs) -> bool:
        saved = original_save(row, **kwargs)
        if kwargs["git_remote"] is not None:
            winner_saved.set()
            assert release_winner.wait(timeout=5)
        return saved

    def observed_clear(manager: GitRemoteManager) -> None:
        if manager.git_dir.name == "loser-mirror":
            loser_cleared.set()
        original_clear(manager)

    def submit(name: str, body: dict) -> None:
        with app.test_client() as client:
            responses[name] = client.post("/setup", json=body, headers={"Origin": origin}).status_code

    winner = setup_payload(origin, "winner-mirror")
    winner["git_remote"] = {
        "transport": "ssh", "remote_url": "git@git.example:org/repository.git",
        "branch": "skills-registry", "known_hosts": "git.example ssh-ed25519 AAAA",
    }
    loser = setup_payload(origin, "loser-mirror")
    repository.save_setup_config = blocking_save  # type: ignore[method-assign]
    GitRemoteManager.clear_credentials = observed_clear
    try:
        winner_thread = threading.Thread(target=submit, args=("winner", winner))
        loser_thread = threading.Thread(target=submit, args=("loser", loser))
        winner_thread.start()
        assert winner_saved.wait(timeout=5)
        loser_thread.start()
        loser_cleared.wait(timeout=1)
        release_winner.set()
        winner_thread.join(timeout=5)
        loser_thread.join(timeout=5)
        assert not winner_thread.is_alive() and not loser_thread.is_alive()
    finally:
        release_winner.set()
        repository.save_setup_config = original_save  # type: ignore[method-assign]
        GitRemoteManager.clear_credentials = original_clear

    assert responses == {"winner": 201, "loser": 404}
    assert (root / "git-credentials/id_ed25519").is_file()
    assert repository.git_remote_config()["remote_url"] == winner["git_remote"]["remote_url"]
    print("concurrent setup winner=sealed loser=404 winning-ssh-credentials=preserved")


def prove_concurrent_git_settings(temp: Path) -> None:
    root = temp / "concurrent-git-settings"
    root.mkdir()
    origin = "http://127.0.0.1:5174"
    settings = Settings(
        database_path=root / "registry.sqlite3", git_dir=root / "legacy-default",
        public_url=origin, google_client_id="", google_client_secret="",
        allowed_google_domains=(), admin_emails=(),
    )
    app = create_app(settings, require_setup=True)
    app.config["TESTING"] = True
    with app.test_client() as client:
        body = setup_payload(origin, "settings-mirror")
        assert client.post("/setup", json=body, headers={"Origin": origin}).status_code == 201
    repository = app.extensions["registry_repository"]
    manager = app.extensions["registry_git_remote"]
    original_save = repository.save_git_remote_config
    ssh_waiting = threading.Event()
    release_ssh = threading.Event()
    https_saved = threading.Event()
    responses: dict[str, int] = {}

    def blocking_save(row: dict) -> None:
        if row["transport"] == "ssh":
            ssh_waiting.set()
            assert release_ssh.wait(timeout=5)
        original_save(row)
        if row["transport"] == "https":
            https_saved.set()

    def configure(name: str, body: dict) -> None:
        with app.test_client() as client:
            responses[name] = client.put(
                "/settings/git", json=body, headers={"Origin": origin},
            ).status_code

    ssh = {
        "transport": "ssh", "remote_url": "git@git.example:org/repository.git",
        "branch": "skills-registry", "known_hosts": "git.example ssh-ed25519 AAAA",
    }
    https = {
        "transport": "https", "remote_url": "https://git.example/org/repository.git",
        "branch": "skills-registry", "username": "registry", "token": "settings-secret-canary",
    }
    repository.save_git_remote_config = blocking_save  # type: ignore[method-assign]
    ssh_thread = threading.Thread(target=configure, args=("ssh", ssh))
    https_thread = threading.Thread(target=configure, args=("https", https))
    ssh_thread.start()
    assert ssh_waiting.wait(timeout=5)
    https_thread.start()
    https_saved.wait(timeout=1)
    release_ssh.set()
    ssh_thread.join(timeout=5)
    https_thread.join(timeout=5)
    repository.save_git_remote_config = original_save  # type: ignore[method-assign]
    assert responses == {"ssh": 200, "https": 200}
    assert repository.git_remote_config()["transport"] == "https"
    assert not (root / "git-credentials/id_ed25519").exists()

    manager.configure(ssh)
    previous_row = repository.git_remote_config()
    previous_key = (root / "git-credentials/id_ed25519").read_bytes()

    def save_then_fail(row: dict) -> None:
        original_save(row)
        raise RuntimeError("simulated post-commit failure")

    repository.save_git_remote_config = save_then_fail  # type: ignore[method-assign]
    try:
        manager.configure(https)
    except RuntimeError:
        pass
    else:
        raise AssertionError("The simulated database failure must escape.")
    finally:
        repository.save_git_remote_config = original_save  # type: ignore[method-assign]
    assert repository.git_remote_config() == previous_row
    assert (root / "git-credentials/id_ed25519").read_bytes() == previous_key

    original_delete = repository.delete_git_remote_config

    def delete_then_fail() -> None:
        original_delete()
        raise RuntimeError("simulated post-delete failure")

    repository.delete_git_remote_config = delete_then_fail  # type: ignore[method-assign]
    try:
        manager.disconnect()
    except RuntimeError:
        pass
    else:
        raise AssertionError("The simulated database failure must escape.")
    finally:
        repository.delete_git_remote_config = original_delete  # type: ignore[method-assign]
    assert repository.git_remote_config() == previous_row
    assert (root / "git-credentials/id_ed25519").read_bytes() == previous_key
    print("git settings concurrent=serialized configure-failure=rolled-back disconnect-failure=rolled-back")


def prove_git_credentials(temp: Path) -> None:
    root = temp / "credential-boundary"
    repository = RegistryRepository(root / "registry.sqlite3")
    repository.initialize()
    git_dir = root / "mirror"
    subprocess.run(["git", "init", "-q", str(git_dir)], check=True)
    manager = GitRemoteManager(repository, git_dir, root / "git-credentials")

    https_token = "https-proof-secret-canary"
    public = manager.configure({
        "transport": "https", "remote_url": "https://git.example/repository.git",
        "branch": "skills-registry", "username": "registry", "token": https_token,
    })
    assert https_token not in json.dumps(public)
    observed: dict[str, str] = {}

    def fake_https(*args: str, env: dict | None = None) -> str:
        assert env is not None
        observed["args"] = " ".join(args)
        observed["username"] = subprocess.run(
            [env["GIT_ASKPASS"], "Username"], env=env, capture_output=True, text=True, check=True,
        ).stdout
        observed["token"] = subprocess.run(
            [env["GIT_ASKPASS"], "Password"], env=env, capture_output=True, text=True, check=True,
        ).stdout
        return ""

    manager._git = fake_https  # type: ignore[method-assign]
    manager.test()
    assert observed["username"] == "registry" and observed["token"] == https_token
    assert https_token not in observed["args"]

    manager = GitRemoteManager(repository, git_dir, root / "git-credentials")
    ssh = manager.configure({
        "transport": "ssh", "remote_url": "git@git.example:org/repository.git",
        "branch": "skills-registry", "known_hosts": "git.example ssh-ed25519 AAAA",
    })
    assert ssh["public_key"].startswith("ssh-ed25519 ")
    key = root / "git-credentials/id_ed25519"
    known = root / "git-credentials/known_hosts"
    assert stat.S_IMODE(key.stat().st_mode) == 0o600
    assert stat.S_IMODE(known.stat().st_mode) == 0o600

    def fake_ssh(*_args: str, env: dict | None = None) -> str:
        assert env is not None
        observed["ssh"] = env["GIT_SSH_COMMAND"]
        return ""

    manager._git = fake_ssh  # type: ignore[method-assign]
    manager.test()
    assert "StrictHostKeyChecking=yes" in observed["ssh"]
    assert str(key) in observed["ssh"] and str(known) in observed["ssh"]
    print("credentials https=askpass-redacted ssh=strict-host-key file-modes=0600")


def prove_rendered_google_setup(temp: Path, parent_project: str, port: int) -> None:
    project = f"{parent_project}-google-ui"
    project_root = temp / "google-ui-root"
    project_root.mkdir()
    workspace = project_root / "workspace"
    workspace.mkdir()
    override = temp / "google-ui.override.yaml"
    override.write_text("services:\n  backend:\n    environment:\n      ALLOW_FILE_GIT_REMOTE: \"1\"\n")
    base = f"http://127.0.0.1:{port}"
    env = {
        **os.environ, "PWD": str(project_root),
        "FRONTEND_PORT": str(port), "FRONTEND_BIND_ADDRESS": "127.0.0.1",
    }
    compose = [
        "docker", "compose", "-p", project,
        "-f", str(ROOT / "deployment" / "prod" / "compose.yaml"),
        "-f", str(override),
    ]
    secret = "rendered-google-secret-canary"
    try:
        command([*compose, "up", "--build", "--detach", "--wait"], env=env)
        logs = command([*compose, "logs", "--no-color", "backend"], env=env).stdout
        assert "bootstrap token" not in logs.casefold()
        browser = subprocess.run(
            ["node", str(ROOT / "docs/features/first-run-instance-setup/proof/ui_google.mjs")],
            cwd=ROOT / "frontend/app",
            env={
                **env, "PROOF_BASE_URL": base, "PROOF_GOOGLE_SECRET": secret,
                "PROOF_HOST_WORKSPACE_PATH": str(workspace),
            },
            text=True, capture_output=True, timeout=60, check=False,
        )
        if browser.returncode != 0:
            raise AssertionError(f"Rendered Google setup failed: {browser.stderr}")
        print(browser.stdout.strip())
        assert setup_status_response(base) == (
            200,
            {
                "configured": False, "verification_required": True,
                "auth_mode": "google", "host_workspace_path": str(workspace),
            },
            "no-store",
        )
        assert (workspace / "google-rendered-mirror/.git").is_dir()
        assert secret not in logs and secret not in browser.stdout and secret not in browser.stderr
    finally:
        command([*compose, "down", "--remove-orphans"], env=env, check=False)


def prove_google_finalization(temp: Path) -> None:
    google_root = temp / "google-boundary"
    google_root.mkdir()
    remote = google_root / "initial-remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    origin = "http://127.0.0.1:5174"
    settings = Settings(
        database_path=google_root / "registry.sqlite3",
        git_dir=google_root / "legacy-default",
        public_url=origin,
        google_client_id="",
        google_client_secret="",
        allowed_google_domains=(),
        admin_emails=(),
    )

    def exchange(code: str) -> dict:
        return {"id_token": code}

    def verify(token: str, nonce: str) -> dict:
        email = "admin@example.com" if token == "admin-code" else "user@example.com"
        return {
            "iss": "https://accounts.google.com", "sub": f"subject-{email}",
            "aud": "corrected-client", "email": email, "email_verified": True,
            "hd": "example.com", "name": email.split("@", 1)[0].title(), "nonce": nonce,
        }

    previous = os.environ.get("ALLOW_FILE_GIT_REMOTE")
    os.environ["ALLOW_FILE_GIT_REMOTE"] = "1"
    try:
        app = create_app(
            settings, require_setup=True, oidc_verifier=verify, oidc_exchange=exchange,
        )
        app.config["TESTING"] = True
        client = app.test_client()
        setup = {
            "auth_mode": "google", "public_url": origin,
            "google_client_id": "initial-client", "google_client_secret": "secret-canary",
            "allowed_google_domains": ["example.com"], "admin_emails": ["admin@example.com"],
            "git_repository": {"name": "google-mirror"},
            "git_remote": {"transport": "file", "remote_url": remote.as_uri(), "branch": "skills-registry"},
        }
        first = client.post("/setup", json=setup, headers={"Origin": origin})
        assert first.status_code == 201 and first.get_json()["setup_finalized"] is False
        assert client.get("/setup/status").get_json() == {
            "configured": False, "verification_required": True, "auth_mode": "google",
            "host_workspace_path": str(google_root.resolve()),
        }
        assert client.get("/skills").status_code == 503
        assert client.get("/settings/git").status_code == 503

        stale_admin = app.test_client()
        stale_start = stale_admin.get("/auth/google/start", query_string={"return_to": "/setup"})
        stale_state = parse_qs(urlsplit(stale_start.location).query)["state"][0]
        first_revision = app.extensions["registry_repository"].installation_config()["setup_revision"]
        setup["google_client_id"] = "corrected-client"
        corrected = client.post("/setup", json=setup, headers={"Origin": origin})
        assert corrected.status_code == 201 and corrected.get_json()["setup_finalized"] is False
        corrected_revision = app.extensions["registry_repository"].installation_config()["setup_revision"]
        assert corrected_revision == first_revision + 1
        stale = stale_admin.get(
            "/auth/google/callback", query_string={"code": "admin-code", "state": stale_state},
        )
        assert stale.status_code == 401
        assert client.get("/setup/status").get_json()["configured"] is False

        user = app.test_client()
        start = user.get("/auth/google/start", query_string={"return_to": "/setup"})
        state = parse_qs(urlsplit(start.location).query)["state"][0]
        denied = user.get("/auth/google/callback", query_string={"code": "user-code", "state": state})
        assert denied.status_code == 403
        assert client.get("/setup/status").get_json()["configured"] is False

        admin = app.test_client()
        start = admin.get("/auth/google/start", query_string={"return_to": "/setup"})
        state = parse_qs(urlsplit(start.location).query)["state"][0]
        callback = admin.get("/auth/google/callback", query_string={"code": "admin-code", "state": state})
        assert callback.status_code == 302
        session = admin.get("/auth/session").get_json()
        assert session["role"] == "admin"
        assert admin.get("/setup/status").get_json() == {"configured": True}
        assert admin.post("/setup", json=setup, headers={"Origin": origin}).status_code == 404
        assert admin.get("/settings/installation").status_code == 404
        assert admin.post("/settings/rollback", json={}).status_code == 404
        git_status = admin.get("/settings/git").get_json()
        assert git_status["enabled"] is True and git_status["remote_url"] == remote.as_uri()
        pushed = admin.post(
            "/settings/git/push",
            headers={"Origin": origin, "X-CSRF-Token": session["csrf_token"]},
        )
        assert pushed.status_code == 200 and pushed.get_json()["push_status"] == "current"
        assert subprocess.run(
            ["git", "--git-dir", str(remote), "rev-parse", "skills-registry"],
            capture_output=True,
        ).returncode == 0
        assert "secret-canary" not in json.dumps(git_status)
    finally:
        if previous is None:
            os.environ.pop("ALLOW_FILE_GIT_REMOTE", None)
        else:
            os.environ["ALLOW_FILE_GIT_REMOTE"] = previous
    print("google provisional=correctable stale-callback=denied nonadmin=denied admin=finalized")


def main() -> None:
    project = f"registry-setup-proof-{uuid.uuid4().hex[:10]}"
    temp = Path(tempfile.mkdtemp(prefix="registry-setup-proof-"))
    project_root = temp / "compose-root"
    project_root.mkdir()
    workspace = project_root / "workspace"
    workspace.mkdir()
    remote = workspace / "proof-remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    override = temp / "compose.override.yaml"
    override.write_text("""services:
  backend:
    environment:
      ALLOW_FILE_GIT_REMOTE: "1"
""")
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {
        **os.environ, "PWD": str(project_root),
        "FRONTEND_PORT": str(port), "FRONTEND_BIND_ADDRESS": "127.0.0.1",
    }
    compose = [
        "docker", "compose", "-p", project,
        "-f", str(ROOT / "deployment" / "prod" / "compose.yaml"),
        "-f", str(override),
    ]
    try:
        configured = command([*compose, "config"], env=env).stdout
        assert "GOOGLE_CLIENT_SECRET" not in configured
        assert configured.count("target: /workspace") == 1
        assert configured.count(str(workspace)) >= 2
        command([*compose, "up", "--build", "--detach", "--wait"], env=env)
        logs = command([*compose, "logs", "--no-color", "backend"], env=env).stdout
        assert "bootstrap token" not in logs.casefold() and "rollback token" not in logs.casefold()
        assert setup_status_response(base) == (
            200,
            {
                "configured": False, "verification_required": False,
                "host_workspace_path": str(workspace),
            },
            "no-store",
        )
        assert request(base, "/api/skills")[0] == 503
        index = urllib.request.urlopen(base, timeout=10).read().decode()
        asset_paths = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css))"', index)
        assets = "\n".join(
            urllib.request.urlopen(urljoin(base, path), timeout=10).read().decode()
            for path in asset_paths
        )
        assert "Bootstrap token" not in assets and "docker compose logs backend" not in assets
        assert str(workspace) not in assets
        obsolete = setup_payload(base, "obsolete-mirror")
        obsolete["bootstrap_token"] = "obsolete"
        assert request(base, "/api/setup", method="POST", origin=True, body=obsolete)[0] == 400
        assert not (workspace / "obsolete-mirror").exists()
        obsolete_repository = setup_payload(base, "obsolete-repository")
        obsolete_repository["git_repository"] = {
            "mode": "existing", "path": "proof-remote.git",
        }
        assert request(
            base, "/api/setup", method="POST", origin=True, body=obsolete_repository,
        )[0] == 400
        assert request(base, "/api/setup/status")[1]["configured"] is False

        setup_git_token = "rendered-https-token-canary"
        browser_env = {
            **env, "PROOF_BASE_URL": base, "PROOF_HTTPS_TOKEN": setup_git_token,
            "PROOF_HOST_WORKSPACE_PATH": str(workspace),
        }
        browser = subprocess.run(
            ["node", str(ROOT / "docs/features/first-run-instance-setup/proof/ui.mjs")],
            cwd=ROOT / "frontend/app", env=browser_env, text=True, capture_output=True,
            timeout=60, check=False,
        )
        if browser.returncode != 0:
            raise AssertionError(f"Browser setup failed: {browser.stderr}")
        print(browser.stdout.strip())
        assert setup_git_token not in browser.stdout and setup_git_token not in browser.stderr
        assert setup_status_response(base) == (200, {"configured": True}, "no-store")
        initial_remote = request(base, "/api/settings/git")[1]
        assert initial_remote["remote_url"] == "https://git.example/operator/registry.git"
        assert initial_remote["credential_configured"] is True
        assert setup_git_token not in json.dumps(initial_remote) and setup_git_token not in logs
        replay = request(base, "/api/setup", method="POST", origin=True, body={
            "auth_mode": "none", "public_url": base,
            "git_repository": {"name": "replay-mirror"},
        })
        assert replay[0] == 404
        assert request(base, "/api/settings/installation")[0] == 404
        assert request(base, "/api/settings/rollback", method="POST", body={})[0] == 404
        created = workspace / "compose-mirror"
        assert (created / ".git").is_dir()
        assert RegistryRepository(
            workspace / "registry.sqlite3"
        ).installation_config()["git_repository_path"] == "compose-mirror"

        git_saved = request(base, "/api/settings/git", method="PUT", origin=True, body={
            "transport": "file", "remote_url": "file:///workspace/proof-remote.git", "branch": "skills-registry",
        })
        assert git_saved[0] == 200 and git_saved[1]["push_status"] == "pending"
        skill = {"slug": "compose-proof", "name": "Compose proof", "description": "Production boundary", "files": {"SKILL.md": "---\nname: compose-proof\n---\n\n# Production proof\n"}}
        assert request(base, "/api/skills", method="POST", body=skill)[0] == 201
        assert request(base, "/api/settings/git")[1]["push_status"] == "current"
        readback = subprocess.run(
            ["git", "--git-dir", str(remote), "show", "skills-registry:skills/compose-proof/SKILL.md"],
            capture_output=True, text=True, check=True,
        ).stdout
        assert readback.endswith("# Production proof\n")

        missing = workspace / "missing-remote.git"
        assert request(base, "/api/settings/git", method="PUT", origin=True, body={
            "transport": "file", "remote_url": "file:///workspace/missing-remote.git", "branch": "skills-registry",
        })[0] == 200
        skill["files"]["SKILL.md"] = "---\nname: compose-proof\n---\n\n# Production proof two\n"
        assert request(base, "/api/skills/compose-proof", method="PUT", body=skill)[0] == 200
        assert request(base, "/api/settings/git")[1]["push_status"] == "pending"
        accepted_sha = subprocess.run(
            ["git", "-C", str(created), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        subprocess.run(["git", "init", "--bare", "-q", str(missing)], check=True)
        retried = request(base, "/api/settings/git/push", method="POST", origin=True)
        assert retried[0] == 200 and retried[1]["last_pushed_sha"] == accepted_sha
        assert request(base, "/api/skills/compose-proof")[1]["latest_version"] == 2

        command([*compose, "down"], env=env)
        command([*compose, "up", "--detach", "--wait"], env=env)
        assert setup_status_response(base) == (200, {"configured": True}, "no-store")
        assert request(base, "/api/skills/compose-proof")[1]["latest_version"] == 2
        final_logs = command([*compose, "logs", "--no-color", "backend"], env=env).stdout
        assert "rollback token" not in final_logs.casefold()
        assert "bootstrap token" not in final_logs.casefold()
        assert setup_git_token not in final_logs

        prove_rendered_google_setup(temp, project, port + 1)
        prove_host_workspace_validation(temp)
        prove_google_finalization(temp)
        prove_repository_boundaries(temp)
        prove_concurrent_setup_sealing(temp)
        prove_concurrent_git_settings(temp)
        prove_git_credentials(temp)
        print(f"runtime python={sys.executable} compose={project} origin={base}")
        print(
            f"repository host={workspace}/compose-mirror "
            f"container=/workspace/compose-mirror remote={accepted_sha[:12]}"
        )
        print("PASS sealed first-run setup and remote-only administration")
    finally:
        command([*compose, "down", "--remove-orphans"], env=env, check=False)
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    main()
