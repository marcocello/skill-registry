from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from backend.app.repository import RegistryRepository


def seed(database: Path, public_url: str) -> None:
    repository = RegistryRepository(database)
    repository.initialize()
    created = repository.create_installation_config(
        {
            "auth_mode": "google",
            "public_url": public_url,
            "google_client_id": "proof-client",
            "google_client_secret": "proof-secret-canary",
            "allowed_google_domains_json": json.dumps(["example.com"]),
            "admin_emails_json": json.dumps(["admin@example.com"]),
        },
        git_repository_path="registry-git",
    )
    if not created:
        raise AssertionError("Google proof installation already exists")


def assert_state(database: Path, git_directory: Path) -> None:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        proposals = connection.execute(
            "SELECT action, slug, status, files_json FROM proposals ORDER BY created_at"
        ).fetchall()
        published = connection.execute(
            "SELECT COUNT(*) FROM skills WHERE slug='google-browser-transfer'"
        ).fetchone()[0]
    if len(proposals) != 1:
        raise AssertionError(f"Expected one durable proposal, found {len(proposals)}")
    proposal = proposals[0]
    if (proposal["action"], proposal["slug"], proposal["status"]) != (
        "create",
        "google-browser-transfer",
        "pending",
    ):
        raise AssertionError(f"Unexpected proposal state: {dict(proposal)}")
    files = json.loads(proposal["files_json"])
    if sorted(files) != ["SKILL.md", "agents/openai.yaml"]:
        raise AssertionError(f"Proposal did not preserve the complete bundle: {sorted(files)}")
    if published:
        raise AssertionError("Google browser upload bypassed review and published")
    if (git_directory / "skills/google-browser-transfer").exists():
        raise AssertionError("Pending Google browser upload changed Git")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("seed", "assert"))
    parser.add_argument("database", type=Path)
    parser.add_argument("public_url")
    parser.add_argument("git_directory", type=Path)
    arguments = parser.parse_args()
    if arguments.mode == "seed":
        seed(arguments.database, arguments.public_url)
    else:
        assert_state(arguments.database, arguments.git_directory)


if __name__ == "__main__":
    main()
