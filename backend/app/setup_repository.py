from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import subprocess

from backend.app.errors import ValidationError
from backend.app.git_export import GitExporter


@dataclass(frozen=True)
class PreparedGitRepository:
    path: Path
    created: bool
    remove_directory: bool

    def rollback(self) -> None:
        if not self.created:
            return
        metadata = self.path / ".git"
        if metadata.is_symlink() or metadata.is_file():
            metadata.unlink(missing_ok=True)
        elif metadata.is_dir():
            shutil.rmtree(metadata)
        if self.remove_directory:
            try:
                self.path.rmdir()
            except OSError:
                pass


@dataclass(frozen=True)
class GitRepositorySelection:
    relative_path: str
    absolute_path: Path

    @classmethod
    def from_payload(
        cls,
        body: object,
        *,
        workspace_root: Path,
        database_path: Path,
    ) -> "GitRepositorySelection":
        if not isinstance(body, dict) or set(body) != {"name"}:
            raise ValidationError("git_repository must contain only name.")
        relative = _repository_name(body.get("name"))
        root = workspace_root.resolve()
        unresolved = root / relative
        if unresolved.is_symlink():
            raise ValidationError("Git repository name cannot select a symlink.")
        candidate = unresolved.resolve(strict=False)
        try:
            candidate.relative_to(root)
        except ValueError as error:
            raise ValidationError("Git repository path must stay inside the workspace.") from error
        database = database_path.resolve()
        credentials = (root / "git-credentials").resolve()
        reserved = {database.name.casefold(), credentials.name.casefold()}
        if relative.casefold() in reserved or candidate in {database, credentials}:
            raise ValidationError("Git repository path is reserved for instance state.")
        return cls(relative, candidate)

    def prepare(self, *, current_path: str | None = None) -> PreparedGitRepository:
        if current_path == self.relative_path and _is_working_repository(self.absolute_path):
            return PreparedGitRepository(self.absolute_path, False, False)
        if self.absolute_path.exists():
            if not self.absolute_path.is_dir() or any(self.absolute_path.iterdir()):
                raise ValidationError("Git repository name must select an absent or empty directory.")
        preparation = PreparedGitRepository(
            self.absolute_path, True, not self.absolute_path.exists(),
        )
        try:
            GitExporter(self.absolute_path).ensure_repository()
        except Exception:
            preparation.rollback()
            raise
        return preparation


def _repository_name(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?", value
    ):
        raise ValidationError(
            "Git repository name must be 1-80 letters, digits, dots, underscores, or hyphens."
        )
    return value


def _is_working_repository(path: Path) -> bool:
    if not path.is_dir():
        return False
    inside = _git(path, "rev-parse", "--is-inside-work-tree")
    bare = _git(path, "rev-parse", "--is-bare-repository")
    top = _git(path, "rev-parse", "--show-toplevel")
    return (
        inside == "true"
        and bare == "false"
        and top is not None
        and Path(top).resolve() == path.resolve()
    )


def _git(path: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args], capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None
