from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable


REPO_ROOT = Path(__file__).resolve().parents[4]
TIMEOUT_SECONDS = 180


def copy_candidate(destination: Path) -> None:
    for relative in ("backend", "frontend/app", "deployment", ".vscode"):
        source = REPO_ROOT / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(
            source,
            target,
            ignore=shutil.ignore_patterns(
                "node_modules", "dist", "__pycache__", ".pytest_cache", ".vitest-attachments"
            ),
        )
    for relative in ("pyproject.toml",):
        shutil.copy2(REPO_ROOT / relative, destination / relative)
    (destination / "workspace").mkdir()


def task_command(candidate: Path) -> list[str]:
    payload = json.loads((candidate / ".vscode/tasks.json").read_text())
    task = next(item for item in payload["tasks"] if item["label"] == "compose:up")
    command = [task["command"], *task["args"]]
    expected = ["docker", "compose", "-f", "deployment/prod/compose.yaml", "up"]
    if command[:5] != expected or "--build" not in command:
        raise AssertionError(f"compose:up does not run docker compose up --build: {command}")
    if "--watch" not in command:
        raise AssertionError(f"compose:up does not enable Compose Watch: {command}")
    return command


def unused_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def request_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=4) as response:
        return response.read().decode()


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
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read() or b"{}")


def wait_until(description: str, probe: Callable[[], bool], process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"Compose task exited early with status {process.returncode}")
        try:
            if probe():
                print(description, flush=True)
                return
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
        time.sleep(1)
    raise AssertionError(f"Timed out waiting for {description}; last error: {last_error}")


def replace_once(path: Path, before: str, after: str) -> None:
    source = path.read_text()
    if source.count(before) < 1:
        raise AssertionError(f"Expected probe source not found in {path}")
    path.write_text(source.replace(before, after, 1))


def cleanup(candidate: Path, project: str, process: subprocess.Popen[str] | None) -> None:
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
    subprocess.run(
        [
            "docker", "compose", "--project-name", project,
            "-f", "deployment/prod/compose.yaml",
            "down", "--volumes", "--remove-orphans",
        ],
        cwd=candidate,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=60,
    )


def main() -> None:
    compose_version = subprocess.run(
        ["docker", "compose", "version", "--short"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    engine_version = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Version}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    print(f"Docker Engine {engine_version}; Docker Compose {compose_version}", flush=True)

    with tempfile.TemporaryDirectory(prefix="compose-watch-proof-") as temporary:
        candidate = Path(temporary)
        copy_candidate(candidate)
        command = task_command(candidate)
        port = unused_port()
        project = f"skills-registry-watch-{os.getpid()}"
        environment = os.environ.copy()
        environment.update(
            COMPOSE_PROJECT_NAME=project,
            FRONTEND_PORT=str(port),
            FRONTEND_BIND_ADDRESS="127.0.0.1",
        )
        log_path = candidate / "compose.log"
        process: subprocess.Popen[str] | None = None
        print(f"Task command: {' '.join(command)}; port: {port}", flush=True)

        try:
            with log_path.open("w") as log:
                process = subprocess.Popen(
                    command,
                    cwd=candidate,
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                gateway = f"http://127.0.0.1:{port}"
                wait_until(
                    "Initial Compose topology is ready",
                    lambda: json.loads(request_text(f"{gateway}/api/health"))["status"] == "ok",
                    process,
                )
                setup = {
                    "auth_mode": "none",
                    "public_url": gateway,
                    "git_repository": {"mode": "new", "path": "compose-watch-git"},
                }
                assert request_json(
                    f"{gateway}/api/setup", method="POST", body=setup, origin=gateway
                )[0] == 201
                skill = {
                    "slug": "compose-watch-durable",
                    "name": "Compose Watch Durable",
                    "description": "Persistence canary across a watched rebuild",
                    "files": {
                        "SKILL.md": "---\nname: compose-watch-durable\n---\n\n# Durable canary\n"
                    },
                }
                assert request_json(
                    f"{gateway}/api/skills", method="POST", body=skill
                )[0] == 201
                assert (candidate / "workspace/compose-watch-git/skills/compose-watch-durable/SKILL.md").is_file()

                replace_once(
                    candidate / "backend/app/main.py",
                    '"status": "ok"',
                    '"status": "compose-watch-backend"',
                )
                wait_until(
                    "Backend source update observed through Nginx: compose-watch-backend",
                    lambda: json.loads(request_text(f"{gateway}/api/health"))["status"]
                    == "compose-watch-backend",
                    process,
                )
                durable_status, durable_skill = request_json(
                    f"{gateway}/api/skills/compose-watch-durable"
                )
                assert durable_status == 200
                assert durable_skill["name"] == "Compose Watch Durable"
                assert durable_skill["latest_version"] == 1
                assert (candidate / "workspace/compose-watch-git/skills/compose-watch-durable/SKILL.md").is_file()
                print(
                    "Registry and Git workspace state survived backend recreation: "
                    "compose-watch-durable v1",
                    flush=True,
                )

                replace_once(
                    candidate / "frontend/app/index.html",
                    "<title>Skill Registry</title>",
                    "<title>Compose Watch Frontend</title>",
                )
                wait_until(
                    "Frontend source update observed through Nginx: Compose Watch Frontend",
                    lambda: "<title>Compose Watch Frontend</title>" in request_text(gateway),
                    process,
                )
        except Exception:
            if log_path.exists():
                print("--- compose log tail ---", flush=True)
                print("\n".join(log_path.read_text(errors="replace").splitlines()[-120:]), flush=True)
            raise
        finally:
            cleanup(candidate, project, process)


if __name__ == "__main__":
    main()
