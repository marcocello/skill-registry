from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from backend.app.validation import file_content_bytes


class GitExportError(RuntimeError):
    pass


class GitExporter:
    OWNED_PATHS = ("skills", "versions", "registry.json")

    def __init__(self, git_dir: Path) -> None:
        self.git_dir = git_dir

    def ensure_repository(self) -> None:
        if self.git_dir.exists() and not self.git_dir.is_dir():
            raise GitExportError("Configured Git path is not a directory.")
        self.git_dir.mkdir(parents=True, exist_ok=True)
        if not (self.git_dir / ".git").exists():
            self._git("init", "-q")

    def export(self, versions: list[dict], *, message: str) -> str | None:
        self.ensure_repository()
        self._replace_generated_content(versions)
        return self._commit(self.OWNED_PATHS, message)

    def export_version(
        self, version: dict, registry: list[dict], *, message: str
    ) -> str | None:
        self.ensure_repository()
        slug = version["slug"]
        number = str(version["version"])
        archive = self.git_dir / "versions" / slug / number
        latest = self.git_dir / "skills" / slug
        self._replace_version(archive, version)
        self._write_json(archive.with_suffix(".json"), _manifest(version))
        self._replace_version(latest, version)
        self._write_json(latest.with_suffix(".json"), _manifest(version))
        self._write_json(self.git_dir / "registry.json", {"skills": registry})
        return self._commit(
            (
                f"versions/{slug}/{number}",
                f"versions/{slug}/{number}.json",
                f"skills/{slug}",
                f"skills/{slug}.json",
                "registry.json",
            ),
            message,
        )

    def generated_content_is_clean(self) -> bool:
        self.ensure_repository()
        result = self._git_result("status", "--porcelain", "--", *self.OWNED_PATHS)
        return result.returncode == 0 and not result.stdout.strip()

    def has_commit(self, commit_sha: str) -> bool:
        return self._git_result("cat-file", "-e", f"{commit_sha}^{{commit}}").returncode == 0

    def _replace_generated_content(self, versions: list[dict]) -> None:
        for directory in (self.git_dir / "skills", self.git_dir / "versions"):
            if directory.exists():
                shutil.rmtree(directory)
            directory.mkdir(parents=True)
            (directory / ".gitkeep").write_text("")
        registry: list[dict] = []
        for version in versions:
            archive = self.git_dir / "versions" / version["slug"] / str(version["version"])
            self._write_version(archive, version)
            self._write_json(archive.with_suffix(".json"), _manifest(version))
            if version["latest"]:
                latest = self.git_dir / "skills" / version["slug"]
                self._write_version(latest, version)
                self._write_json(latest.with_suffix(".json"), _manifest(version))
                registry.append(_registry_entry(version))
        self._write_json(self.git_dir / "registry.json", {"skills": registry})

    def _write_version(self, destination: Path, version: dict) -> None:
        destination.mkdir(parents=True, exist_ok=True)
        for relative_path, content in version["files"].items():
            target = destination.joinpath(*relative_path.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(file_content_bytes(relative_path, content))

    def _replace_version(self, destination: Path, version: dict) -> None:
        if destination.exists():
            shutil.rmtree(destination)
        self._write_version(destination, version)

    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def _head_sha(self) -> str | None:
        result = self._git_result("rev-parse", "--verify", "HEAD")
        return result.stdout.strip() if result.returncode == 0 else None

    def _commit(self, paths: tuple[str, ...], message: str) -> str | None:
        self._git("add", "--", *paths)
        if self._git_result("diff", "--cached", "--quiet", "--", *paths).returncode == 0:
            return self._head_sha()
        self._git("commit", "-q", "-m", message, "--", *paths, env=self._commit_env())
        return self._head_sha()

    def _git(self, *args: str, env: dict[str, str] | None = None) -> str:
        result = self._git_result(*args, env=env)
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or "Git command failed."
            raise GitExportError(message)
        return result.stdout.strip()

    def _git_result(
        self, *args: str, env: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                ["git", "-C", str(self.git_dir), *args],
                capture_output=True,
                text=True,
                timeout=20,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GitExportError(str(error)) from error

    def _commit_env(self) -> dict[str, str]:
        return {
            **os.environ,
            "GIT_AUTHOR_NAME": os.environ.get("GIT_EXPORT_AUTHOR_NAME", "Skill Registry"),
            "GIT_AUTHOR_EMAIL": os.environ.get(
                "GIT_EXPORT_AUTHOR_EMAIL", "registry@example.invalid"
            ),
            "GIT_COMMITTER_NAME": os.environ.get(
                "GIT_EXPORT_AUTHOR_NAME", "Skill Registry"
            ),
            "GIT_COMMITTER_EMAIL": os.environ.get(
                "GIT_EXPORT_AUTHOR_EMAIL", "registry@example.invalid"
            ),
        }


def _manifest(version: dict) -> dict:
    return {
        "slug": version["slug"],
        "name": version["name"],
        "description": version["description"],
        "version": version["version"],
        "content_hash": version["content_hash"],
        "owner": version["owner"],
        "author": version["author"],
        "created_at": version["created_at"],
    }


def _registry_entry(version: dict) -> dict:
    return {
        "slug": version["slug"],
        "name": version["name"],
        "description": version["description"],
        "version": version["version"],
        "content_hash": version["content_hash"],
        "owner": version["owner"],
    }
