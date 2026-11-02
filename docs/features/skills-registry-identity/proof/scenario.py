from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import urllib.request
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]


def unused_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def copy_candidate(destination: Path) -> None:
    for relative in ("backend", "frontend/app", "deployment"):
        shutil.copytree(
            REPO_ROOT / relative,
            destination / relative,
            ignore=shutil.ignore_patterns(
                "node_modules", "dist", "__pycache__", ".pytest_cache", ".vitest-attachments"
            ),
        )
    for relative in ("pyproject.toml",):
        shutil.copy2(REPO_ROOT / relative, destination / relative)
    (destination / "workspace").mkdir()


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, object] | None = None,
    origin: str | None = None,
) -> tuple[int, dict[str, object]]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if origin is not None:
        headers["Origin"] = origin
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.status, json.loads(response.read() or b"{}")


def compose_command(candidate: Path, project: str, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "docker", "compose", "--project-name", project,
            "-f", "deployment/prod/compose.yaml", *arguments,
        ],
        cwd=candidate,
        text=True,
        capture_output=True,
        timeout=240,
        check=True,
    )


def main() -> None:
    engine = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Version}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    compose = subprocess.run(
        ["docker", "compose", "version", "--short"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    print(f"runtime docker={engine} compose={compose}", flush=True)

    with tempfile.TemporaryDirectory(prefix="skills-registry-proof-") as temporary:
        candidate = Path(temporary)
        copy_candidate(candidate)
        project = f"skills-registry-proof-{uuid.uuid4().hex[:10]}"
        port = unused_port()
        origin = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        environment.update(
            PWD=str(candidate),
            FRONTEND_PORT=str(port),
            FRONTEND_BIND_ADDRESS="127.0.0.1",
        )
        print(f"candidate={candidate} origin={origin} project={project}", flush=True)

        try:
            subprocess.run(
                [
                    "docker",
                    "compose",
                    "--project-name",
                    project,
                    "-f",
                    "deployment/prod/compose.yaml",
                    "up",
                    "--build",
                    "--detach",
                    "--wait",
                ],
                cwd=candidate,
                env=environment,
                text=True,
                capture_output=True,
                timeout=240,
                check=True,
            )
            setup_status, setup = request_json(
                f"{origin}/api/setup",
                method="POST",
                origin=origin,
                body={
                    "auth_mode": "none",
                    "public_url": origin,
                    "git_repository": {"name": "identity-proof-git"},
                },
            )
            assert setup_status == 201, setup
            print("setup=open finalized", flush=True)

            initialize_status, initialize = request_json(
                f"{origin}/mcp",
                method="POST",
                body={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-03-26",
                        "capabilities": {},
                        "clientInfo": {"name": "identity-proof", "version": "1.0"},
                    },
                },
            )
            assert initialize_status == 200 and "error" not in initialize, initialize
            result = initialize["result"]
            assert result["serverInfo"]["name"] == "skills-registry", result
            instructions = str(result["instructions"])
            assert "Skill Registry" in instructions, instructions
            assert "skills.toml" in instructions, instructions
            assert "local Codex skills" in instructions, instructions

            tools_status, tools = request_json(
                f"{origin}/mcp",
                method="POST",
                body={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            )
            tool_names = {tool["name"] for tool in tools["result"]["tools"]}
            assert tools_status == 200
            assert {"skills.create", "skills.update"}.issubset(tool_names), tool_names
            companion_url = f"{origin}/companion/skills-registry-guide/SKILL.md"
            with urllib.request.urlopen(companion_url, timeout=15) as response:
                companion = response.read().decode()
            assert "name: skills-registry-guide" in companion, companion
            assert "skills.list" in companion, companion
            assert "skills.get" in companion, companion
            assert "complete bundle" in companion, companion
            assert "returned state" in companion, companion
            print("mcp=skills-registry tools=create,update companion=valid", flush=True)

            browser = subprocess.run(
                ["node", str(REPO_ROOT / "docs/features/skills-registry-identity/proof/ui.mjs")],
                cwd=REPO_ROOT / "frontend/app",
                env={**environment, "PROOF_BASE_URL": origin},
                text=True,
                capture_output=True,
                timeout=60,
                check=False,
            )
            if browser.returncode != 0:
                raise AssertionError(f"Browser identity proof failed:\n{browser.stderr}")
            print(browser.stdout.strip(), flush=True)
        except Exception:
            try:
                logs = compose_command(candidate, project, "logs", "--no-color")
                print("--- compose log tail ---", flush=True)
                print("\n".join(logs.stdout.splitlines()[-100:]), flush=True)
            except Exception:
                pass
            raise
        finally:
            subprocess.run(
                [
                    "docker",
                    "compose",
                    "--project-name",
                    project,
                    "down",
                    "--volumes",
                    "--remove-orphans",
                ],
                cwd=candidate,
                env=environment,
                text=True,
                capture_output=True,
                timeout=90,
                check=False,
            )


if __name__ == "__main__":
    main()
