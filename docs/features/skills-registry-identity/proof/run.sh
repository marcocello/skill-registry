#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$repo_root"

export PYTHONDONTWRITEBYTECODE=1
exec .venv/bin/python docs/features/skills-registry-identity/proof/scenario.py
