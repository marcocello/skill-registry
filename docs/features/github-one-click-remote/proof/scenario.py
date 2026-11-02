from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import uuid
from pathlib import Path

from fake_github import FakeGithub


ROOT = Path(__file__).resolve().parents[4]


def command(args: list[str], *, env: dict[str, str], check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        args, cwd=ROOT, env=env, text=True, capture_output=True,
        check=False, timeout=360,
    )
    if check and completed.returncode != 0:
        raise AssertionError(
            f"Command failed ({completed.returncode}): {' '.join(args)}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return completed


def free_port(offset: int) -> int:
    return 22000 + (os.getpid() + offset) % 18000


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read())


def main() -> None:
    project = f"registry-github-proof-{uuid.uuid4().hex[:10]}"
    temp = Path(tempfile.mkdtemp(prefix="registry-github-proof-"))
    project_root = temp / "compose-root"
    workspace = project_root / "workspace"
    workspace.mkdir(parents=True)
    remote_root = workspace / "github-remotes"
    provider_port = free_port(0)
    portal_port = free_port(1)
    provider = FakeGithub(provider_port, remote_root)
    provider.start()
    override = temp / "compose.override.yaml"
    override.write_text(
        "services:\n"
        "  backend:\n"
        "    environment:\n"
        "      GITHUB_PROOF_ENDPOINTS: \"1\"\n"
        f"      GITHUB_WEB_BASE: http://127.0.0.1:{provider_port}\n"
        f"      GITHUB_API_BASE: http://host.docker.internal:{provider_port}/api\n"
        f"      GITHUB_TOKEN_BASE: http://host.docker.internal:{provider_port}\n"
        "      GITHUB_GIT_BASE: file:///workspace/github-remotes\n"
    )
    base = f"http://127.0.0.1:{portal_port}"
    env = {
        **os.environ,
        "PWD": str(project_root),
        "FRONTEND_PORT": str(portal_port),
        "FRONTEND_BIND_ADDRESS": "127.0.0.1",
    }
    compose = [
        "docker", "compose", "-p", project,
        "-f", str(ROOT / "deployment" / "prod" / "compose.yaml"),
        "-f", str(override),
    ]
    try:
        command([*compose, "up", "--build", "--detach", "--wait"], env=env)
        browser = subprocess.run(
            ["node", str(ROOT / "docs/features/github-one-click-remote/proof/ui.mjs")],
            cwd=ROOT / "frontend/app",
            env={
                **env, "PROOF_BASE_URL": base,
                "PROOF_HOST_WORKSPACE_PATH": str(workspace),
                "PROOF_GITHUB_URL": f"http://127.0.0.1:{provider_port}",
            },
            text=True, capture_output=True, timeout=90, check=False,
        )
        if browser.returncode != 0:
            raise AssertionError(f"Rendered GitHub flow failed:\n{browser.stdout}\n{browser.stderr}")
        print(browser.stdout.strip())
        assert provider.manifest["public"] is True
        assert provider.manifest["default_permissions"] == {
            "administration": "write", "contents": "write", "metadata": "read",
        }
        creates = [call for call in provider.calls if call == ("POST", "/api/user/repos")]
        assert len(creates) == 1
        assert not [call for call in provider.calls if call[0] == "DELETE"]
        remote = remote_root / "proof-owner/github-created-remote.git"
        ref = subprocess.run(
            ["git", "--git-dir", str(remote), "rev-parse", "skills-registry"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        assert (workspace / "github-local-mirror/.git").is_dir()
        assert remote.is_dir()
        logs = command([*compose, "logs", "--no-color"], env=env).stdout
        for secret in (
            "proof-client-secret-canary", "proof-user-token-canary",
            "proof-installation-token-", "BEGIN PRIVATE KEY", "ghs_", "ghb_",
            "manual-proof-token-canary",
        ):
            assert secret not in logs and secret not in browser.stdout and secret not in browser.stderr

        command(
            [
                sys.executable, "-m", "pytest", "-q",
                "tests/test_github_one_click_remote.py",
                "tests/test_oidc_registry.py",
                "tests/test_first_run_setup.py",
            ],
            env=env,
        )
        assert get_json(base + "/api/setup/status") == {"configured": True}
        print(
            f"runtime python={sys.executable} compose={project} origin={base} "
            f"provider=proof-owner/github-created-remote ref={ref[:12]}"
        )
        print("PASS GitHub.com one-click and Manual remote configuration")
    finally:
        command([*compose, "down", "--remove-orphans"], env=env, check=False)
        provider.close()
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    main()
