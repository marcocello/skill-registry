from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator

from backend.app.bundle_metadata import openai_display_name
from backend.app.errors import ConflictError, NotFoundError
from backend.app.validation import SkillPayload


SCHEMA = """
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    latest_version INTEGER NOT NULL,
    owner_user_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    files_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    author_user_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    git_export_status TEXT NOT NULL DEFAULT 'pending',
    git_commit_sha TEXT,
    git_export_error TEXT,
    UNIQUE(skill_id, version)
);

CREATE TABLE IF NOT EXISTS skill_deletions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    git_export_error TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    picture_url TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(issuer, subject)
);

CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS browser_sessions_token_hash_idx ON browser_sessions(token_hash);

CREATE TABLE IF NOT EXISTS oidc_states (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    binding_hash TEXT NOT NULL,
    nonce TEXT NOT NULL,
    return_to TEXT NOT NULL,
    setup_revision INTEGER,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
    user_id TEXT NOT NULL REFERENCES users(id),
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
    user_id TEXT NOT NULL REFERENCES users(id),
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
    user_id TEXT NOT NULL REFERENCES users(id),
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK(action IN ('create', 'update')),
    slug TEXT NOT NULL,
    base_version INTEGER,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    files_json TEXT NOT NULL,
    author_user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    revision INTEGER NOT NULL DEFAULT 1,
    edited_by_user_id TEXT REFERENCES users(id),
    decided_by_user_id TEXT REFERENCES users(id),
    decision_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT
);

CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status, created_at);

CREATE TABLE IF NOT EXISTS installation_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    auth_mode TEXT NOT NULL CHECK(auth_mode IN ('none', 'google')),
    public_url TEXT NOT NULL,
    google_client_id TEXT,
    google_client_secret TEXT,
    allowed_google_domains_json TEXT NOT NULL DEFAULT '[]',
    admin_emails_json TEXT NOT NULL DEFAULT '[]',
    git_repository_path TEXT NOT NULL DEFAULT 'registry-git',
    setup_revision INTEGER NOT NULL DEFAULT 1,
    admin_verified_revision INTEGER,
    remote_ready_revision INTEGER,
    setup_finalized_at TEXT,
    previous_policy_json TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS git_remote_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    provider TEXT NOT NULL DEFAULT 'manual' CHECK(provider IN ('manual', 'github')),
    remote_url TEXT NOT NULL,
    branch TEXT NOT NULL,
    transport TEXT NOT NULL CHECK(transport IN ('https', 'ssh', 'file')),
    username TEXT,
    token TEXT,
    push_status TEXT NOT NULL DEFAULT 'pending',
    last_pushed_sha TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_app_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    app_id TEXT NOT NULL,
    private_key TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    repository_name TEXT NOT NULL,
    app_slug TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_connection_attempts (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    binding_hash TEXT NOT NULL,
    context TEXT NOT NULL CHECK(context IN ('setup', 'settings')),
    actor_user_id TEXT,
    setup_revision INTEGER,
    repository_name TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK(visibility IN ('private', 'public')),
    branch TEXT NOT NULL,
    stage TEXT NOT NULL,
    app_id TEXT,
    client_id TEXT,
    client_secret TEXT,
    private_key TEXT,
    app_slug TEXT,
    installation_id TEXT,
    account_login TEXT,
    account_type TEXT,
    repository_id TEXT,
    repository_url TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS github_attempt_state_idx
ON github_connection_attempts(state_hash, expires_at);
"""


class RegistryRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    def initialize(self) -> None:
        previous_umask = os.umask(0o077)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self.connection() as connection:
                migrations = []
                skill_columns = _table_columns(connection, "skills")
                version_columns = _table_columns(connection, "skill_versions")
                installation_columns = _table_columns(connection, "installation_config")
                remote_columns = _table_columns(connection, "git_remote_config")
                oidc_state_columns = _table_columns(connection, "oidc_states")
                if skill_columns and "owner_user_id" not in skill_columns:
                    migrations.append(
                        "ALTER TABLE skills ADD COLUMN owner_user_id TEXT REFERENCES users(id)"
                    )
                if version_columns and "author_user_id" not in version_columns:
                    migrations.append(
                        "ALTER TABLE skill_versions ADD COLUMN author_user_id TEXT REFERENCES users(id)"
                    )
                if installation_columns and "git_repository_path" not in installation_columns:
                    migrations.append(
                        "ALTER TABLE installation_config ADD COLUMN git_repository_path TEXT NOT NULL DEFAULT 'registry-git'"
                    )
                if installation_columns and "setup_finalized_at" not in installation_columns:
                    migrations.extend([
                        "ALTER TABLE installation_config ADD COLUMN setup_finalized_at TEXT",
                        "UPDATE installation_config SET setup_finalized_at = updated_at WHERE setup_finalized_at IS NULL",
                    ])
                if installation_columns and "setup_revision" not in installation_columns:
                    migrations.append(
                        "ALTER TABLE installation_config ADD COLUMN setup_revision INTEGER NOT NULL DEFAULT 1"
                    )
                if installation_columns and "admin_verified_revision" not in installation_columns:
                    migrations.append(
                        "ALTER TABLE installation_config ADD COLUMN admin_verified_revision INTEGER"
                    )
                if installation_columns and "remote_ready_revision" not in installation_columns:
                    migrations.extend([
                        "ALTER TABLE installation_config ADD COLUMN remote_ready_revision INTEGER",
                        "UPDATE installation_config SET remote_ready_revision = setup_revision WHERE setup_finalized_at IS NOT NULL",
                    ])
                if remote_columns and "provider" not in remote_columns:
                    migrations.append(
                        "ALTER TABLE git_remote_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'manual'"
                    )
                if oidc_state_columns and "setup_revision" not in oidc_state_columns:
                    migrations.append(
                        "ALTER TABLE oidc_states ADD COLUMN setup_revision INTEGER"
                    )
                connection.executescript(
                    f"""
                    BEGIN IMMEDIATE;
                    DROP INDEX IF EXISTS access_tokens_token_hash_idx;
                    DROP TABLE IF EXISTS access_tokens;
                    {SCHEMA}
                    {';'.join(migrations)};
                    COMMIT;
                    """
                )
                self._scrub_expired_github_attempts(connection, _timestamp())
            self.database_path.chmod(0o600)
        finally:
            os.umask(previous_umask)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def installation_config(self) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM installation_config WHERE id = 1"
            ).fetchone()
        return dict(row) if row is not None else None

    def create_installation_config(
        self,
        row: dict,
        previous_policy_json: str | None = None,
        *,
        git_repository_path: str = "registry-git",
    ) -> bool:
        now = _timestamp()
        with self.connection() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO installation_config (
                    id, auth_mode, public_url, google_client_id, google_client_secret,
                    allowed_google_domains_json, admin_emails_json,
                    git_repository_path, setup_finalized_at,
                    previous_policy_json, updated_at
                ) VALUES (1, :auth_mode, :public_url, :google_client_id,
                          :google_client_secret, :allowed_google_domains_json,
                          :admin_emails_json, :git_repository_path, :setup_finalized_at,
                          :previous_policy_json, :updated_at)
                """,
                {
                    **row, "git_repository_path": git_repository_path,
                    "setup_finalized_at": now, "previous_policy_json": previous_policy_json,
                    "updated_at": now,
                },
            )
        return cursor.rowcount == 1

    def save_setup_config(
        self,
        row: dict,
        *,
        git_repository_path: str,
        finalized: bool,
        git_remote: dict | None,
        remote_ready: bool = True,
    ) -> int | None:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT setup_finalized_at, setup_revision FROM installation_config WHERE id=1"
            ).fetchone()
            if current is not None and current["setup_finalized_at"] is not None:
                return None
            setup_revision = (current["setup_revision"] + 1) if current is not None else 1
            connection.execute(
                """
                INSERT INTO installation_config (
                    id, auth_mode, public_url, google_client_id, google_client_secret,
                    allowed_google_domains_json, admin_emails_json,
                    git_repository_path, setup_revision, setup_finalized_at,
                    admin_verified_revision, remote_ready_revision,
                    previous_policy_json, updated_at
                ) VALUES (
                    1, :auth_mode, :public_url, :google_client_id, :google_client_secret,
                    :allowed_google_domains_json, :admin_emails_json,
                    :git_repository_path, :setup_revision, :setup_finalized_at,
                    NULL, :remote_ready_revision,
                    NULL, :updated_at
                )
                ON CONFLICT(id) DO UPDATE SET
                    auth_mode=:auth_mode, public_url=:public_url,
                    google_client_id=:google_client_id,
                    google_client_secret=:google_client_secret,
                    allowed_google_domains_json=:allowed_google_domains_json,
                    admin_emails_json=:admin_emails_json,
                    git_repository_path=:git_repository_path,
                    setup_revision=:setup_revision,
                    admin_verified_revision=NULL,
                    remote_ready_revision=:remote_ready_revision,
                    setup_finalized_at=:setup_finalized_at,
                    previous_policy_json=NULL, updated_at=:updated_at
                """,
                {
                    **row, "git_repository_path": git_repository_path,
                    "setup_revision": setup_revision,
                    "setup_finalized_at": now if finalized else None, "updated_at": now,
                    "remote_ready_revision": setup_revision if remote_ready else None,
                },
            )
            connection.execute("DELETE FROM oidc_states")
            connection.execute("DELETE FROM github_connection_attempts WHERE context='setup'")
            connection.execute("DELETE FROM git_remote_config WHERE id=1")
            if git_remote is not None:
                connection.execute(
                    """
                    INSERT INTO git_remote_config (
                        id, provider, remote_url, branch, transport, username, token,
                        push_status, last_pushed_sha, last_error, updated_at
                    ) VALUES (
                        1, 'manual', :remote_url, :branch, :transport, :username, :token,
                        'pending', NULL, NULL, :updated_at
                    )
                    """,
                    {**git_remote, "updated_at": now},
                )
        return setup_revision

    def finalize_installation(self, setup_revision: int) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE installation_config SET setup_finalized_at=?, updated_at=?
                WHERE id=1 AND setup_finalized_at IS NULL AND setup_revision=?
                """,
                (_timestamp(), _timestamp(), setup_revision),
            )
        return cursor.rowcount == 1

    def mark_setup_admin_verified(self, setup_revision: int) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE installation_config SET admin_verified_revision=?, updated_at=?
                WHERE id=1 AND setup_finalized_at IS NULL AND setup_revision=?
                """,
                (setup_revision, _timestamp(), setup_revision),
            )
        return cursor.rowcount == 1

    def mark_setup_remote_ready(self, setup_revision: int) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE installation_config SET remote_ready_revision=?, updated_at=?
                WHERE id=1 AND setup_finalized_at IS NULL AND setup_revision=?
                """,
                (setup_revision, _timestamp(), setup_revision),
            )
        return cursor.rowcount == 1

    def finalize_ready_installation(self, setup_revision: int) -> bool:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM installation_config WHERE id=1"
            ).fetchone()
            if row is None or row["setup_finalized_at"] is not None or row["setup_revision"] != setup_revision:
                return False
            ready = row["remote_ready_revision"] == setup_revision
            if row["auth_mode"] == "google":
                ready = ready and row["admin_verified_revision"] == setup_revision
            if not ready:
                return False
            now = _timestamp()
            cursor = connection.execute(
                """
                UPDATE installation_config SET setup_finalized_at=?, updated_at=?
                WHERE id=1 AND setup_finalized_at IS NULL AND setup_revision=?
                """,
                (now, now, setup_revision),
            )
        return cursor.rowcount == 1

    def update_installation_config(self, row: dict, previous_policy_json: str) -> None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE installation_config SET
                    auth_mode = :auth_mode, public_url = :public_url,
                    google_client_id = :google_client_id,
                    google_client_secret = :google_client_secret,
                    allowed_google_domains_json = :allowed_google_domains_json,
                    admin_emails_json = :admin_emails_json,
                    previous_policy_json = :previous_policy_json,
                    updated_at = :updated_at
                WHERE id = 1
                """,
                {**row, "previous_policy_json": previous_policy_json, "updated_at": _timestamp()},
            )
            self._revoke_all_authorization(connection, _timestamp())

    def rollback_installation_config(self) -> dict | None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT previous_policy_json FROM installation_config WHERE id = 1"
            ).fetchone()
            if current is None or current["previous_policy_json"] is None:
                return None
            previous = json.loads(current["previous_policy_json"])
            record = {
                "auth_mode": previous["auth_mode"],
                "public_url": previous["public_url"],
                "google_client_id": previous.get("google_client_id", ""),
                "google_client_secret": previous.get("google_client_secret", ""),
                "allowed_google_domains_json": json.dumps(previous.get("allowed_google_domains", [])),
                "admin_emails_json": json.dumps(previous.get("admin_emails", [])),
                "updated_at": _timestamp(),
            }
            connection.execute(
                """
                UPDATE installation_config SET auth_mode=:auth_mode,
                    public_url=:public_url, google_client_id=:google_client_id,
                    google_client_secret=:google_client_secret,
                    allowed_google_domains_json=:allowed_google_domains_json,
                    admin_emails_json=:admin_emails_json,
                    previous_policy_json=NULL, updated_at=:updated_at WHERE id=1
                """,
                record,
            )
            self._revoke_all_authorization(connection, record["updated_at"])
        return self.installation_config()

    def revoke_all_authorization(self) -> None:
        with self.connection() as connection:
            self._revoke_all_authorization(connection, _timestamp())

    @staticmethod
    def _revoke_all_authorization(connection: sqlite3.Connection, now: str) -> None:
        connection.execute(
            "UPDATE browser_sessions SET revoked_at=? WHERE revoked_at IS NULL", (now,)
        )
        connection.execute("DELETE FROM oidc_states")
        connection.execute("DELETE FROM oauth_codes")
        connection.execute(
            "UPDATE oauth_access_tokens SET revoked_at=? WHERE revoked_at IS NULL", (now,)
        )
        connection.execute(
            "UPDATE oauth_refresh_tokens SET revoked_at=? WHERE revoked_at IS NULL", (now,)
        )

    def git_remote_config(self) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM git_remote_config WHERE id=1").fetchone()
        return dict(row) if row is not None else None

    def save_git_remote_config(self, row: dict) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO git_remote_config (
                    id, provider, remote_url, branch, transport, username, token,
                    push_status, last_pushed_sha, last_error, updated_at
                ) VALUES (1, :provider, :remote_url, :branch, :transport, :username, :token,
                          'pending', NULL, NULL, :updated_at)
                ON CONFLICT(id) DO UPDATE SET provider=:provider, remote_url=:remote_url,
                    branch=:branch, transport=:transport, username=:username,
                    token=:token, push_status='pending', last_pushed_sha=NULL,
                    last_error=NULL, updated_at=:updated_at
                """,
                {"provider": "manual", **row, "updated_at": _timestamp()},
            )

    def mark_git_remote(self, status: str, sha: str | None, error: str | None) -> None:
        with self.connection() as connection:
            connection.execute(
                "UPDATE git_remote_config SET push_status=?, last_pushed_sha=?, last_error=?, updated_at=? WHERE id=1",
                (status, sha, error[:300] if error else None, _timestamp()),
            )

    def delete_git_remote_config(self) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM github_app_config WHERE id=1")
            connection.execute("DELETE FROM git_remote_config WHERE id=1")

    def restore_git_remote_config(self, row: dict | None) -> None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM git_remote_config WHERE id=1")
            if row is not None:
                connection.execute(
                    """
                    INSERT INTO git_remote_config (
                        id, provider, remote_url, branch, transport, username, token,
                        push_status, last_pushed_sha, last_error, updated_at
                    ) VALUES (
                        1, :provider, :remote_url, :branch, :transport, :username, :token,
                        :push_status, :last_pushed_sha, :last_error, :updated_at
                    )
                    """,
                    row,
                )

    def github_app_config(self) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM github_app_config WHERE id=1").fetchone()
        return dict(row) if row is not None else None

    def create_github_attempt(self, row: dict) -> None:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._scrub_expired_github_attempts(connection, now)
            if connection.execute("SELECT 1 FROM git_remote_config WHERE id=1").fetchone():
                raise ConflictError("Disconnect the active Git remote before connecting another.")
            connection.execute("DELETE FROM github_connection_attempts WHERE context=?", (row["context"],))
            connection.execute(
                """
                INSERT INTO github_connection_attempts (
                    id, state_hash, binding_hash, context, actor_user_id, setup_revision,
                    repository_name, visibility, branch, stage, created_at, expires_at, updated_at
                ) VALUES (
                    :id, :state_hash, :binding_hash, :context, :actor_user_id, :setup_revision,
                    :repository_name, :visibility, :branch, 'manifest_pending', :created_at,
                    :expires_at, :updated_at
                )
                """,
                {**row, "created_at": now, "updated_at": now},
            )

    def github_attempt(self, state_hash: str, binding_hash: str) -> dict | None:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._scrub_expired_github_attempts(connection, now)
            row = connection.execute(
                """
                SELECT * FROM github_connection_attempts
                WHERE state_hash=? AND binding_hash=? AND expires_at>? 
                """,
                (state_hash, binding_hash, now),
            ).fetchone()
        return dict(row) if row is not None else None

    def transition_github_attempt(
        self, attempt_id: str, expected_stage: str, next_stage: str, values: dict,
    ) -> bool:
        allowed = {
            "state_hash", "app_id", "client_id", "client_secret", "private_key",
            "app_slug", "installation_id", "account_login", "account_type",
            "repository_id", "repository_url", "last_error",
        }
        if not set(values).issubset(allowed):
            raise ValueError("Unsupported GitHub attempt field.")
        assignments = ["stage=:next_stage", "updated_at=:updated_at"]
        assignments.extend(f"{name}=:{name}" for name in values)
        payload = {
            **values, "id": attempt_id, "expected_stage": expected_stage,
            "next_stage": next_stage, "updated_at": _timestamp(),
        }
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                f"UPDATE github_connection_attempts SET {', '.join(assignments)} WHERE id=:id AND stage=:expected_stage",
                payload,
            )
        return cursor.rowcount == 1

    def github_attempt_by_id(self, attempt_id: str) -> dict | None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._scrub_expired_github_attempts(connection, _timestamp())
            row = connection.execute(
                "SELECT * FROM github_connection_attempts WHERE id=?", (attempt_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    @staticmethod
    def _scrub_expired_github_attempts(
        connection: sqlite3.Connection, now: str,
    ) -> None:
        connection.execute(
            """
            UPDATE github_connection_attempts
            SET stage='expired', client_secret=NULL, private_key=NULL, updated_at=?
            WHERE expires_at<=?
              AND stage NOT IN ('promoted', 'failed', 'expired')
            """,
            (now, now),
        )

    def promote_github_remote(self, attempt_id: str, remote_url: str) -> dict:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attempt = connection.execute(
                "SELECT * FROM github_connection_attempts WHERE id=? AND stage='repository_created'",
                (attempt_id,),
            ).fetchone()
            if attempt is None:
                raise ConflictError("GitHub connection is not ready for promotion.")
            if connection.execute("SELECT 1 FROM git_remote_config WHERE id=1").fetchone():
                raise ConflictError("A Git remote is already configured.")
            now = _timestamp()
            connection.execute(
                """
                INSERT INTO git_remote_config (
                    id, provider, remote_url, branch, transport, username, token,
                    push_status, last_pushed_sha, last_error, updated_at
                ) VALUES (1, 'github', ?, ?, 'https', 'x-access-token', NULL,
                          'pending', NULL, NULL, ?)
                """,
                (remote_url, attempt["branch"], now),
            )
            connection.execute(
                """
                INSERT INTO github_app_config (
                    id, app_id, private_key, installation_id, account_login,
                    account_type, repository_id, repository_name, app_slug, updated_at
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    attempt["app_id"], attempt["private_key"], attempt["installation_id"],
                    attempt["account_login"], attempt["account_type"],
                    attempt["repository_id"], attempt["repository_name"], attempt["app_slug"], now,
                ),
            )
            connection.execute(
                "UPDATE github_connection_attempts SET stage='promoted', client_secret=NULL, private_key=NULL, updated_at=? WHERE id=?",
                (now, attempt_id),
            )
        return self.git_remote_config() or {}

    def create_skill(self, payload: SkillPayload) -> dict:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM skills WHERE slug = ?", (payload.slug,)).fetchone():
                raise ConflictError(f"Skill already exists: {payload.slug}")
            cursor = connection.execute(
                """
                INSERT INTO skills (slug, name, description, latest_version, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (payload.slug, payload.name, payload.description, now, now),
            )
            version_id = self._insert_version(connection, cursor.lastrowid, 1, payload, now)
        return self.get_version(version_id)

    def update_skill(
        self, payload: SkillPayload, *, expected_version: int | None = None
    ) -> dict:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            skill = connection.execute(
                "SELECT id, latest_version FROM skills WHERE slug = ?", (payload.slug,)
            ).fetchone()
            if skill is None:
                raise NotFoundError(f"Skill not found: {payload.slug}")
            if expected_version is not None and skill["latest_version"] != expected_version:
                raise ConflictError(
                    f"Skill changed after version {expected_version} was downloaded."
                )
            version = int(skill["latest_version"]) + 1
            connection.execute(
                """
                UPDATE skills SET name = ?, description = ?, latest_version = ?, updated_at = ?
                WHERE id = ?
                """,
                (payload.name, payload.description, version, now, skill["id"]),
            )
            version_id = self._insert_version(connection, skill["id"], version, payload, now)
        return self.get_version(version_id)

    def delete_skill(self, slug: str) -> dict:
        now = _timestamp()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            skill = connection.execute(
                "SELECT slug, latest_version FROM skills WHERE slug = ?", (slug,)
            ).fetchone()
            if skill is None:
                raise NotFoundError(f"Skill not found: {slug}")
            connection.execute("DELETE FROM skills WHERE slug = ?", (slug,))
            connection.execute(
                """
                INSERT INTO skill_deletions (slug, created_at, git_export_error)
                VALUES (?, ?, NULL)
                ON CONFLICT(slug) DO UPDATE SET
                    created_at = excluded.created_at, git_export_error = NULL
                """,
                (slug, now),
            )
        return {
            "slug": skill["slug"],
            "deleted_versions": skill["latest_version"],
            "created_at": now,
        }

    def current_versions(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT v.*, s.slug,
                       author.email AS author_email,
                       author.display_name AS author_display_name
                FROM skill_versions v
                JOIN skills s ON s.id = v.skill_id AND s.latest_version = v.version
                LEFT JOIN users author ON author.id = v.author_user_id
                ORDER BY s.slug
                """
            ).fetchall()
        return [_version_payload(row, row["slug"]) for row in rows]

    def _insert_version(
        self,
        connection: sqlite3.Connection,
        skill_id: int,
        version: int,
        payload: SkillPayload,
        created_at: str,
        author_user_id: str | None = None,
    ) -> int:
        files_json = json.dumps(payload.files, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        digest_source = json.dumps(
            {
                "slug": payload.slug,
                "name": payload.name,
                "description": payload.description,
                "files": payload.files,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        cursor = connection.execute(
            """
            INSERT INTO skill_versions (
                skill_id, version, name, description, files_json, content_hash,
                author_user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                skill_id,
                version,
                payload.name,
                payload.description,
                files_json,
                hashlib.sha256(digest_source).hexdigest(),
                author_user_id,
                created_at,
            ),
        )
        return int(cursor.lastrowid)

    def list_skills(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT s.slug, s.name, s.description, s.latest_version, s.updated_at,
                       v.content_hash, v.git_export_status, v.files_json,
                       owner.id AS owner_user_id, owner.email AS owner_email,
                       owner.display_name AS owner_display_name
                FROM skills s
                JOIN skill_versions v ON v.skill_id = s.id AND v.version = s.latest_version
                LEFT JOIN users owner ON owner.id = s.owner_user_id
                ORDER BY s.slug
                """
            ).fetchall()
        summaries = []
        for row in rows:
            summary = dict(row)
            files = json.loads(summary.pop("files_json"))
            summary["owner"] = _identity_payload(summary, "owner")
            _drop_identity_columns(summary, "owner")
            summary["display_name"] = openai_display_name(files)
            summary["file_count"] = len(files)
            summary["file_paths"] = sorted(files)
            summaries.append(summary)
        return summaries

    def get_skill(self, slug: str) -> dict:
        with self.connection() as connection:
            skill = connection.execute(
                """
                SELECT s.*, owner.id AS owner_user_id,
                       owner.email AS owner_email,
                       owner.display_name AS owner_display_name
                FROM skills s
                LEFT JOIN users owner ON owner.id = s.owner_user_id
                WHERE s.slug = ?
                """,
                (slug,),
            ).fetchone()
            if skill is None:
                raise NotFoundError(f"Skill not found: {slug}")
            versions = connection.execute(
                """
                SELECT v.*, author.id AS author_user_id,
                       author.email AS author_email,
                       author.display_name AS author_display_name
                FROM skill_versions v
                LEFT JOIN users author ON author.id = v.author_user_id
                WHERE v.skill_id = ? ORDER BY v.version
                """,
                (skill["id"],),
            ).fetchall()
        version_payloads = [_version_payload(row, slug) for row in versions]
        latest = next(
            version for version in version_payloads if version["version"] == skill["latest_version"]
        )
        return {
            "slug": skill["slug"],
            "name": skill["name"],
            "display_name": openai_display_name(latest["files"]),
            "description": skill["description"],
            "latest_version": skill["latest_version"],
            "owner": _identity_payload(skill, "owner"),
            "created_at": skill["created_at"],
            "updated_at": skill["updated_at"],
            "versions": version_payloads,
        }

    def get_version(self, version_id: int) -> dict:
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT v.*, s.slug,
                       author.id AS author_user_id,
                       author.email AS author_email,
                       author.display_name AS author_display_name,
                       owner.id AS owner_user_id,
                       owner.email AS owner_email,
                       owner.display_name AS owner_display_name
                FROM skill_versions v
                JOIN skills s ON s.id = v.skill_id
                LEFT JOIN users author ON author.id = v.author_user_id
                LEFT JOIN users owner ON owner.id = s.owner_user_id
                WHERE v.id = ?
                """,
                (version_id,),
            ).fetchone()
        if row is None:
            raise NotFoundError(f"Version not found: {version_id}")
        payload = _version_payload(row, row["slug"])
        payload["owner"] = _identity_payload(row, "owner")
        payload["id"] = row["id"]
        return payload

    def export_snapshot(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT v.*, s.slug, s.latest_version,
                       author.id AS author_user_id,
                       author.email AS author_email,
                       author.display_name AS author_display_name,
                       owner.id AS owner_user_id,
                       owner.email AS owner_email,
                       owner.display_name AS owner_display_name
                FROM skill_versions v
                JOIN skills s ON s.id = v.skill_id
                LEFT JOIN users author ON author.id = v.author_user_id
                LEFT JOIN users owner ON owner.id = s.owner_user_id
                ORDER BY s.slug, v.version
                """
            ).fetchall()
        return [
            {
                **_version_payload(row, row["slug"]),
                "owner": _identity_payload(row, "owner"),
                "latest": row["version"] == row["latest_version"],
            }
            for row in rows
        ]

    def registry_snapshot(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT s.slug, s.name, s.description, s.latest_version,
                       v.content_hash,
                       owner.id AS owner_user_id,
                       owner.email AS owner_email,
                       owner.display_name AS owner_display_name
                FROM skills s
                JOIN skill_versions v
                  ON v.skill_id = s.id AND v.version = s.latest_version
                LEFT JOIN users owner ON owner.id = s.owner_user_id
                ORDER BY s.slug
                """
            ).fetchall()
        return [
            {
                "slug": row["slug"],
                "name": row["name"],
                "description": row["description"],
                "version": row["latest_version"],
                "content_hash": row["content_hash"],
                "owner": _identity_payload(row, "owner"),
            }
            for row in rows
        ]

    def mark_exported(self, commit_sha: str | None) -> None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE skill_versions
                SET git_export_status = 'exported', git_commit_sha = ?, git_export_error = NULL
                WHERE git_export_status = 'pending'
                """,
                (commit_sha,),
            )
            connection.execute("DELETE FROM skill_deletions")

    def mark_version_exported(self, version_id: int, commit_sha: str | None) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE skill_versions
                SET git_export_status = 'exported', git_commit_sha = ?,
                    git_export_error = NULL
                WHERE id = ? AND git_export_status = 'pending'
                """,
                (commit_sha, version_id),
            )

    def mark_export_failed(self, version_id: int, error: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE skill_versions
                SET git_export_status = 'pending', git_export_error = ?
                WHERE id = ?
                """,
                (error[:500], version_id),
            )

    def mark_deletion_export_failed(self, slug: str, error: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                UPDATE skill_deletions SET git_export_error = ? WHERE slug = ?
                """,
                (error[:500], slug),
            )

    def exported_versions(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT id, git_commit_sha FROM skill_versions
                WHERE git_export_status = 'exported' AND git_commit_sha IS NOT NULL
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def mark_exports_missing(self, version_ids: list[int]) -> None:
        if not version_ids:
            return
        placeholders = ",".join("?" for _item in version_ids)
        with self.connection() as connection:
            connection.execute(
                f"""
                UPDATE skill_versions
                SET git_export_status = 'pending', git_commit_sha = NULL,
                    git_export_error = 'Previously exported Git commit is unavailable.'
                WHERE id IN ({placeholders})
                """,
                version_ids,
            )

    def pending_export_count(self) -> int:
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM skill_versions
                     WHERE git_export_status = 'pending')
                    + (SELECT COUNT(*) FROM skill_deletions)
                """
            ).fetchone()
        return int(row[0])

    def upsert_user(self, identity: dict, user_id: str, now: str) -> dict:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE issuer = ? AND subject = ?",
                (identity["issuer"], identity["subject"]),
            ).fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO users (
                        id, issuer, subject, email, display_name, picture_url,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        identity["issuer"],
                        identity["subject"],
                        identity["email"],
                        identity["display_name"],
                        identity.get("picture_url"),
                        now,
                        now,
                    ),
                )
            else:
                user_id = row["id"]
                connection.execute(
                    """
                    UPDATE users SET email = ?, display_name = ?, picture_url = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        identity["email"],
                        identity["display_name"],
                        identity.get("picture_url"),
                        now,
                        user_id,
                    ),
                )
        return self.get_user(user_id)

    def get_user(self, user_id: str) -> dict:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"User not found: {user_id}")
        return dict(row)

    def create_browser_session(self, row: dict) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO browser_sessions (
                    id, token_hash, csrf_hash, user_id, created_at, expires_at
                ) VALUES (:id, :token_hash, :csrf_hash, :user_id, :created_at, :expires_at)
                """,
                row,
            )

    def browser_session(self, token_hash: str, now: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT s.*, u.issuer, u.subject, u.email, u.display_name,
                       u.picture_url, u.disabled
                FROM browser_sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            if row is not None:
                connection.execute(
                    "UPDATE browser_sessions SET last_used_at = ? WHERE id = ?",
                    (now, row["id"]),
                )
        return dict(row) if row is not None else None

    def revoke_browser_session(self, token_hash: str, now: str) -> None:
        with self.connection() as connection:
            connection.execute(
                "UPDATE browser_sessions SET revoked_at = ? WHERE token_hash = ?",
                (now, token_hash),
            )

    def create_oidc_state(self, row: dict) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO oidc_states (
                    id, state_hash, binding_hash, nonce, return_to, setup_revision,
                    created_at, expires_at
                ) VALUES (
                    :id, :state_hash, :binding_hash, :nonce, :return_to,
                    :setup_revision, :created_at, :expires_at
                )
                """,
                row,
            )

    def consume_oidc_state(
        self,
        state_hash: str,
        binding_hash: str,
        now: str,
        setup_revision: int | None,
    ) -> dict | None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM oidc_states
                WHERE state_hash = ? AND binding_hash = ? AND used_at IS NULL AND expires_at > ?
                  AND ((? IS NULL AND setup_revision IS NULL) OR setup_revision = ?)
                """,
                (state_hash, binding_hash, now, setup_revision, setup_revision),
            ).fetchone()
            if row is not None:
                connection.execute("UPDATE oidc_states SET used_at = ? WHERE id = ?", (now, row["id"]))
        return dict(row) if row is not None else None

    def create_oauth_client(self, row: dict) -> None:
        with self.connection() as connection:
            count = connection.execute("SELECT COUNT(*) FROM oauth_clients").fetchone()[0]
            if count >= 100:
                raise ConflictError("OAuth client registration limit reached.")
            connection.execute(
                "INSERT INTO oauth_clients VALUES (:client_id, :client_name, :redirect_uris_json, :created_at)",
                row,
            )

    def oauth_client(self, client_id: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM oauth_clients WHERE client_id = ?", (client_id,)).fetchone()
        return dict(row) if row is not None else None

    def create_oauth_code(self, row: dict) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO oauth_codes (
                    id, code_hash, client_id, user_id, redirect_uri, scope,
                    resource, code_challenge, created_at, expires_at
                ) VALUES (:id, :code_hash, :client_id, :user_id, :redirect_uri,
                          :scope, :resource, :code_challenge, :created_at, :expires_at)
                """,
                row,
            )

    def consume_oauth_code(
        self,
        code_hash: str,
        now: str,
        client_id: str,
        redirect_uri: str,
        resource: str,
        challenge: str,
    ) -> dict | None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM oauth_codes
                WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
                  AND client_id = ? AND redirect_uri = ? AND resource = ?
                  AND code_challenge = ?
                """,
                (code_hash, now, client_id, redirect_uri, resource, challenge),
            ).fetchone()
            if row is not None:
                connection.execute("UPDATE oauth_codes SET used_at = ? WHERE id = ?", (now, row["id"]))
        return dict(row) if row is not None else None

    def create_oauth_tokens(self, access: dict, refresh: dict) -> None:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO oauth_access_tokens (
                    id, token_hash, family_id, client_id, user_id, scope,
                    resource, created_at, expires_at
                ) VALUES (:id, :token_hash, :family_id, :client_id, :user_id,
                          :scope, :resource, :created_at, :expires_at)
                """,
                access,
            )
            connection.execute(
                """
                INSERT INTO oauth_refresh_tokens (
                    id, token_hash, family_id, client_id, user_id, scope,
                    resource, created_at, expires_at
                ) VALUES (:id, :token_hash, :family_id, :client_id, :user_id,
                          :scope, :resource, :created_at, :expires_at)
                """,
                refresh,
            )

    def access_token(self, token_hash: str, now: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT t.*, u.email, u.display_name, u.disabled
                FROM oauth_access_tokens t JOIN users u ON u.id = t.user_id
                WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
        return dict(row) if row is not None else None

    def consume_refresh_token(self, token_hash: str, now: str, client_id: str) -> tuple[dict | None, bool]:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None or row["client_id"] != client_id or row["revoked_at"] is not None or row["expires_at"] <= now:
                return None, False
            replay = row["used_at"] is not None
            if replay:
                self._revoke_family(connection, row["family_id"], now)
            else:
                connection.execute("UPDATE oauth_refresh_tokens SET used_at = ? WHERE id = ?", (now, row["id"]))
        return dict(row), replay

    def revoke_oauth_token(self, token_hash: str, now: str) -> None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT family_id FROM oauth_refresh_tokens WHERE token_hash = ? UNION SELECT family_id FROM oauth_access_tokens WHERE token_hash = ?",
                (token_hash, token_hash),
            ).fetchone()
            if row is not None:
                self._revoke_family(connection, row["family_id"], now)

    @staticmethod
    def _revoke_family(connection: sqlite3.Connection, family_id: str, now: str) -> None:
        connection.execute("UPDATE oauth_access_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL", (now, family_id))
        connection.execute("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL", (now, family_id))

    def create_proposal(self, row: dict) -> dict:
        with self.connection() as connection:
            connection.execute(
                """
                INSERT INTO proposals (
                    id, action, slug, base_version, name, description, files_json,
                    author_user_id, created_at, updated_at
                ) VALUES (:id, :action, :slug, :base_version, :name, :description,
                          :files_json, :author_user_id, :created_at, :updated_at)
                """,
                row,
            )
        return self.get_proposal(row["id"])

    def list_proposals(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT p.*, a.email AS author_email, e.email AS editor_email,
                       d.email AS reviewer_email
                FROM proposals p JOIN users a ON a.id = p.author_user_id
                LEFT JOIN users e ON e.id = p.edited_by_user_id
                LEFT JOIN users d ON d.id = p.decided_by_user_id
                ORDER BY p.created_at DESC
                """
            ).fetchall()
        return [_proposal_payload(row) for row in rows]

    def get_proposal(self, proposal_id: str) -> dict:
        with self.connection() as connection:
            row = connection.execute(
                """
                SELECT p.*, a.email AS author_email, e.email AS editor_email,
                       d.email AS reviewer_email
                FROM proposals p JOIN users a ON a.id = p.author_user_id
                LEFT JOIN users e ON e.id = p.edited_by_user_id
                LEFT JOIN users d ON d.id = p.decided_by_user_id
                WHERE p.id = ?
                """,
                (proposal_id,),
            ).fetchone()
        if row is None:
            raise NotFoundError(f"Proposal not found: {proposal_id}")
        return _proposal_payload(row)

    def edit_proposal(self, proposal_id: str, revision: int, payload: SkillPayload, editor: str, now: str) -> dict:
        with self.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE proposals SET name = ?, description = ?, files_json = ?,
                    edited_by_user_id = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND status = 'pending' AND revision = ?
                """,
                (payload.name, payload.description, json.dumps(payload.files, sort_keys=True), editor, now, proposal_id, revision),
            )
            if cursor.rowcount != 1:
                raise ConflictError("Proposal is no longer pending at that revision.")
        return self.get_proposal(proposal_id)

    def decide_proposal(self, proposal_id: str, revision: int, reviewer: str, reason: str, now: str, approve: bool) -> tuple[dict, int | None]:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"Proposal not found: {proposal_id}")
            if row["status"] != "pending" or row["revision"] != revision:
                raise ConflictError("Proposal is no longer pending at that revision.")
            version_id = self._publish_proposal(connection, row, now) if approve else None
            status = "approved" if approve else "rejected"
            connection.execute(
                """
                UPDATE proposals SET status = ?, decided_by_user_id = ?,
                    decision_reason = ?, decided_at = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND status = 'pending' AND revision = ?
                """,
                (status, reviewer, reason, now, now, proposal_id, revision),
            )
        return self.get_proposal(proposal_id), version_id

    def _publish_proposal(self, connection: sqlite3.Connection, row: sqlite3.Row, now: str) -> int:
        payload = SkillPayload(row["slug"], row["name"], row["description"], json.loads(row["files_json"]))
        skill = connection.execute("SELECT id, latest_version FROM skills WHERE slug = ?", (payload.slug,)).fetchone()
        if row["action"] == "create":
            if skill is not None:
                raise ConflictError(f"Skill already exists: {payload.slug}")
            cursor = connection.execute(
                """
                INSERT INTO skills (
                    slug, name, description, latest_version, owner_user_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    payload.slug,
                    payload.name,
                    payload.description,
                    row["author_user_id"],
                    now,
                    now,
                ),
            )
            return self._insert_version(
                connection,
                cursor.lastrowid,
                1,
                payload,
                now,
                row["author_user_id"],
            )
        if skill is None or skill["latest_version"] != row["base_version"]:
            raise ConflictError("Published skill changed after this proposal was submitted.")
        version = int(skill["latest_version"]) + 1
        connection.execute(
            "UPDATE skills SET name = ?, description = ?, latest_version = ?, updated_at = ? WHERE id = ?",
            (payload.name, payload.description, version, now, skill["id"]),
        )
        return self._insert_version(
            connection,
            skill["id"],
            version,
            payload,
            now,
            row["author_user_id"],
        )


def _version_payload(row: sqlite3.Row, slug: str) -> dict:
    return {
        "slug": slug,
        "version": row["version"],
        "name": row["name"],
        "description": row["description"],
        "files": json.loads(row["files_json"]),
        "content_hash": row["content_hash"],
        "author": _identity_payload(row, "author"),
        "created_at": row["created_at"],
        "git_export": {
            "status": row["git_export_status"],
            "commit_sha": row["git_commit_sha"],
            "error": row["git_export_error"],
        },
    }


def _proposal_payload(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "action": row["action"],
        "slug": row["slug"],
        "base_version": row["base_version"],
        "name": row["name"],
        "description": row["description"],
        "files": json.loads(row["files_json"]),
        "status": row["status"],
        "revision": row["revision"],
        "author": row["author_email"],
        "edited_by": row["editor_email"],
        "reviewed_by": row["reviewer_email"],
        "decision_reason": row["decision_reason"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "decided_at": row["decided_at"],
    }


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}


def _identity_payload(row: sqlite3.Row | dict, prefix: str) -> dict | None:
    user_id = row[f"{prefix}_user_id"]
    if user_id is None:
        return None
    return {
        "user_id": user_id,
        "email": row[f"{prefix}_email"],
        "display_name": row[f"{prefix}_display_name"],
    }


def _drop_identity_columns(payload: dict, prefix: str) -> None:
    for suffix in ("user_id", "email", "display_name"):
        payload.pop(f"{prefix}_{suffix}", None)
