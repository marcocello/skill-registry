#!/usr/bin/env bash
set -euo pipefail

feature_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$feature_dir/../../.." && pwd)"

cd "$repo_root"

legacy_name='open''space'
starter_name='shadcn''-admin'
starter_display='shadcn'' admin'
starter_author='sat''naing'
starter_author_spaced='sat ''naing'
singular_env='SKILL_''REGISTRY_'
starter_env='VITE_''CLERK_'
if rg -i \
  --hidden \
  --no-ignore \
  --glob '!.git/**' \
  --glob '!.venv/**' \
  --glob '!frontend/app/node_modules/**' \
  --glob '!frontend/app/dist/**' \
  --glob '!**/__pycache__/**' \
  --glob '!.pytest_cache/**' \
  --glob '!**/proof/runs/**' \
  -e "$legacy_name" \
  -e "$starter_name" \
  -e "$starter_display" \
  -e "$starter_author" \
  -e "$starter_author_spaced" \
  -e "$singular_env" \
  -e "$starter_env" \
  .; then
  echo "conflicting product identity remains in an active repository surface" >&2
  exit 1
fi

cd "$repo_root/frontend/app"
pnpm run test:e2e
