from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path


mode = os.environ["PROOF_MODE"]
state_dir = Path(os.environ["PROOF_STATE_DIR"])
connection = sqlite3.connect(state_dir / "registry.sqlite3")
remaining = [row[0] for row in connection.execute("SELECT slug FROM skills ORDER BY slug")]
version_count = connection.execute("SELECT COUNT(*) FROM skill_versions").fetchone()[0]
pending_deletions = connection.execute("SELECT COUNT(*) FROM skill_deletions").fetchone()[0]
proposals = connection.execute(
    "SELECT slug, status FROM proposals ORDER BY slug"
).fetchall()
connection.close()

expected = [] if mode == "open" else ["protected-skill"]
assert remaining == expected, (mode, remaining)
assert version_count == len(expected), (mode, version_count)
assert pending_deletions == 0, (mode, pending_deletions)
assert proposals == (
    [] if mode == "open" else [("admin-list-delete", "pending")]
)

git_dir = state_dir / "registry-git"
registry = json.loads((git_dir / "registry.json").read_text())
assert [item["slug"] for item in registry["skills"]] == expected
deleted = (
    ["list-delete-one", "list-delete-two", "detail-delete"]
    if mode == "open"
    else ["admin-list-delete", "admin-detail-delete"]
)
for slug in deleted:
    assert not (git_dir / "skills" / slug).exists()
    assert not (git_dir / "versions" / slug).exists()
    assert not (git_dir / "versions" / slug / "1").exists()
    if slug in {"list-delete-one", "admin-list-delete"}:
        assert not (git_dir / "versions" / slug / "2").exists()

print(f"State verified: mode={mode} remaining={remaining} versions={version_count}")
