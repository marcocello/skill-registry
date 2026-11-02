#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$repo_root"

pnpm --dir frontend/app run build
exec node docs/features/companion-client-installation/proof/scenario.mjs
