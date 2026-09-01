from __future__ import annotations

import base64
import os
import re
import shlex
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.app.errors import ConflictError, ValidationError
from backend.app.repository import RegistryRepository


SCP_REMOTE = re.compile(r"^(?P<user>[A-Za-z0-9._-]+)@(?P<host>[A-Za-z0-9.-]+):(?P<path>[A-Za-z0-9._~@+/-]+)$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9.\[\]:,-]+$")
SAFE_SSH_PATH = re.compile(r"^/[A-Za-z0-9._~@+/-]+$")


@dataclass(frozen=True)
class PreparedGitRemote:
    row: dict
    known_hosts: str | None = None


@dataclass(frozen=True)
class CredentialSnapshot:
    files: dict[str, bytes]


class GitRemoteManager:
    def __init__(
        self,
        repository: RegistryRepository,
        git_dir: Path,
        credentials_dir: Path,
        github_token_minter: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.git_dir = git_dir
        self.credentials_dir = credentials_dir
        self.allow_file = os.environ.get("ALLOW_FILE_GIT_REMOTE") == "1"
        self._operation_lock = threading.RLock()
        self.github_token_minter = github_token_minter

    def public(self) -> dict:
        with self._operation_lock:
            row = self.repository.git_remote_config()
            if row is None:
                return {"enabled": False, "push_status": "disabled", "branch": "skills-registry"}
            return {
                "enabled": True,
                "provider": row.get("provider", "manual"),
                "remote_url": row["remote_url"],
                "branch": row["branch"],
                "transport": row["transport"],
                "username": row["username"] or "",
                "credential_configured": bool(
                    row["token"] or row["transport"] == "ssh" or row.get("provider") == "github"
                ),
                "public_key": self._public_key() if row["transport"] == "ssh" else None,
                "push_status": row["push_status"],
                "last_pushed_sha": row["last_pushed_sha"],
                "last_error": row["last_error"],
                **self._github_public(row),
            }

    def configure(self, body: dict) -> dict:
        with self._operation_lock:
            current = self.repository.git_remote_config()
            if current is not None and current.get("provider", "manual") != "manual":
                raise ConflictError("Disconnect the active GitHub remote before configuring Manual.")
            prepared = self.prepare(body)
            row_snapshot = self.repository.git_remote_config()
            credential_snapshot = self.snapshot_credentials()
            try:
                self.apply_credentials(prepared)
                self.repository.save_git_remote_config(prepared.row)
            except Exception:
                self._restore_remote_state(row_snapshot, credential_snapshot)
                raise
            return self.public()

    def prepare(self, body: dict) -> PreparedGitRemote:
        if not isinstance(body, dict):
            raise ValidationError("Git Settings must be an object.")
        current = self.repository.git_remote_config()
        transport = body.get("transport")
        remote_url = body.get("remote_url")
        branch = body.get("branch", "skills-registry")
        if transport not in {"https", "ssh"} and not (transport == "file" and self.allow_file):
            raise ValidationError("Git transport must be HTTPS or SSH.")
        if not isinstance(remote_url, str) or not isinstance(branch, str):
            raise ValidationError("Git remote URL and branch are required.")
        self._validate_branch(branch)
        host = self._validate_url(remote_url, transport)
        username = None
        token = None
        known_hosts = None
        if transport == "https":
            username = _required(body.get("username"), "HTTPS username")
            token_value = body.get("token")
            token = current["token"] if token_value is None and current and current["transport"] == "https" else _required(token_value, "HTTPS token")
        elif transport == "ssh":
            known_hosts = _required(body.get("known_hosts"), "SSH known_hosts")
            self._validate_known_hosts(known_hosts, host)
        return PreparedGitRemote({
            "provider": "manual", "remote_url": remote_url, "branch": branch, "transport": transport,
            "username": username, "token": token,
        }, known_hosts)

    def apply_credentials(self, prepared: PreparedGitRemote) -> None:
        if prepared.row["transport"] == "ssh":
            self._write_ssh_files(prepared.known_hosts or "")
        else:
            self._remove_ssh_files()

    def clear_credentials(self) -> None:
        self._remove_ssh_files()

    def snapshot_credentials(self) -> CredentialSnapshot:
        files = {}
        for name in ("id_ed25519", "known_hosts"):
            path = self.credentials_dir / name
            if path.is_file():
                files[name] = path.read_bytes()
        return CredentialSnapshot(files)

    def restore_credentials(self, snapshot: CredentialSnapshot) -> None:
        self._remove_ssh_files()
        if not snapshot.files:
            return
        self.credentials_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.credentials_dir, 0o700)
        for name, contents in snapshot.files.items():
            path = self.credentials_dir / name
            path.write_bytes(contents)
            path.chmod(0o600)

    def disconnect(self) -> dict:
        with self._operation_lock:
            row_snapshot = self.repository.git_remote_config()
            credential_snapshot = self.snapshot_credentials()
            try:
                self.clear_credentials()
                self.repository.delete_git_remote_config()
            except Exception:
                self._restore_remote_state(row_snapshot, credential_snapshot)
                raise
            return self.public()

    def test(self) -> dict:
        with self._operation_lock:
            row = self._configured()
            remote = self._ls_remote(row)
            return {"reachable": True, "branch_exists": bool(remote), "compatible": self._compatible(remote)}

    def push(self) -> dict:
        with self._operation_lock:
            row = self._configured()
            try:
                remote_sha = self._ls_remote(row)
                if not self._compatible(remote_sha):
                    raise ConflictError("Remote branch is not an ancestor of this managed history.")
                head = self._git("rev-parse", "HEAD")
                self._git_with_credentials(row, "push", row["remote_url"], f"HEAD:refs/heads/{row['branch']}")
                self.repository.mark_git_remote("current", head, None)
            except ConflictError:
                self.repository.mark_git_remote("pending", None, "Remote branch has incompatible history.")
                raise
            except Exception:
                self.repository.mark_git_remote("pending", None, "Remote Git operation failed.")
            return self.public()

    def _restore_remote_state(
        self,
        row_snapshot: dict | None,
        credential_snapshot: CredentialSnapshot,
    ) -> None:
        try:
            self.repository.restore_git_remote_config(row_snapshot)
        finally:
            self.restore_credentials(credential_snapshot)

    def _configured(self) -> dict:
        row = self.repository.git_remote_config()
        if row is None:
            raise ConflictError("No Git remote is configured.")
        return row

    def _ls_remote(self, row: dict) -> str | None:
        output = self._git_with_credentials(row, "ls-remote", row["remote_url"], f"refs/heads/{row['branch']}")
        return output.split()[0] if output.strip() else None

    def _compatible(self, remote_sha: str | None) -> bool:
        if remote_sha is None:
            return True
        fetched = subprocess.run(
            ["git", "-C", str(self.git_dir), "cat-file", "-e", f"{remote_sha}^{{commit}}"],
            capture_output=True,
        )
        if fetched.returncode != 0:
            return False
        return subprocess.run(
            ["git", "-C", str(self.git_dir), "merge-base", "--is-ancestor", remote_sha, "HEAD"],
            capture_output=True,
        ).returncode == 0

    def _git_with_credentials(self, row: dict, *args: str) -> str:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        askpass: str | None = None
        if row["transport"] == "https":
            self.credentials_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd, askpass = tempfile.mkstemp(dir=self.credentials_dir, prefix="askpass-")
            os.write(fd, b"#!/bin/sh\ncase \"$1\" in *Username*) printf '%s' \"$GIT_HTTP_USERNAME\";; *) printf '%s' \"$GIT_HTTP_TOKEN\";; esac\n")
            os.close(fd)
            os.chmod(askpass, 0o700)
            token = row["token"]
            if row.get("provider") == "github":
                if self.github_token_minter is None:
                    raise ConflictError("GitHub App credentials are unavailable.")
                token = self.github_token_minter()
            env.update(GIT_ASKPASS=askpass, GIT_HTTP_USERNAME=row["username"], GIT_HTTP_TOKEN=token)
        elif row["transport"] == "ssh":
            key = self.credentials_dir / "id_ed25519"
            known = self.credentials_dir / "known_hosts"
            env["GIT_SSH_COMMAND"] = " ".join(shlex.quote(part) for part in [
                "ssh", "-i", str(key), "-o", "IdentitiesOnly=yes", "-o",
                "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={known}",
            ])
        try:
            return self._git(*args, env=env)
        finally:
            if askpass:
                Path(askpass).unlink(missing_ok=True)

    def _git(self, *args: str, env: dict | None = None) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.git_dir), *args], capture_output=True, text=True,
            timeout=20, env=env,
        )
        if result.returncode != 0:
            raise RuntimeError("Remote Git command failed.")
        return result.stdout.strip()

    @staticmethod
    def _validate_branch(branch: str) -> None:
        if branch.startswith("-") or any(ord(char) < 32 for char in branch):
            raise ValidationError("Git branch is invalid.")
        if subprocess.run(["git", "check-ref-format", "--branch", branch], capture_output=True).returncode != 0:
            raise ValidationError("Git branch is invalid.")

    def _validate_url(self, value: str, transport: str) -> str:
        if any(ord(char) < 32 for char in value) or value.startswith("-") or "ext::" in value:
            raise ValidationError("Git remote URL is unsafe.")
        parsed = urlsplit(value)
        if transport == "https":
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValidationError("HTTPS remote must be a credential-free https:// URL.")
            return parsed.hostname
        if transport == "file" and self.allow_file and parsed.scheme == "file":
            return "localhost"
        match = SCP_REMOTE.fullmatch(value)
        if match and not match.group("path").startswith("-"):
            return match.group("host")
        if parsed.scheme == "ssh" and parsed.hostname and parsed.username and not parsed.password and not parsed.query and not parsed.fragment and SAFE_SSH_PATH.fullmatch(parsed.path):
            return parsed.hostname
        raise ValidationError("SSH remote URL is invalid.")

    def _write_ssh_files(self, known_hosts: str) -> None:
        self.credentials_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.credentials_dir, 0o700)
        private_path = self.credentials_dir / "id_ed25519"
        if not private_path.exists():
            key = Ed25519PrivateKey.generate()
            private_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption()))
        private_path.chmod(0o600)
        known_path = self.credentials_dir / "known_hosts"
        known_path.write_text(known_hosts.rstrip() + "\n")
        known_path.chmod(0o600)

    def _public_key(self) -> str | None:
        private_path = self.credentials_dir / "id_ed25519"
        if not private_path.exists():
            return None
        key = serialization.load_ssh_private_key(private_path.read_bytes(), password=None)
        return key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()

    def _validate_known_hosts(self, value: str, host: str) -> None:
        valid = False
        for line in value.splitlines():
            parts = line.split()
            if len(parts) < 3 or not SAFE_HOST.fullmatch(parts[0]) or parts[1] not in {"ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"}:
                raise ValidationError("known_hosts contains an invalid line.")
            try:
                base64.b64decode(parts[2], validate=True)
            except ValueError as error:
                raise ValidationError("known_hosts contains invalid key data.") from error
            valid = valid or host in parts[0].split(",")
        if not valid:
            raise ValidationError("known_hosts must contain the exact remote host.")

    def _remove_ssh_files(self) -> None:
        for name in ("id_ed25519", "known_hosts"):
            (self.credentials_dir / name).unlink(missing_ok=True)

    def _github_public(self, row: dict) -> dict:
        if row.get("provider") != "github":
            return {}
        config = self.repository.github_app_config() or {}
        return {
            "account_login": config.get("account_login"),
            "account_type": config.get("account_type"),
            "repository_name": config.get("repository_name"),
            "repository_url": (
                f"https://github.com/{config.get('account_login')}/"
                f"{config.get('repository_name')}"
            ),
        }


def _required(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 4000:
        raise ValidationError(f"{label} is required.")
    return value.strip()
