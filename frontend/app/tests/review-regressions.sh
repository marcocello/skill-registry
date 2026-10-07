#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm run build
pnpm exec eslint src/registry
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true; wait "$preview_pid" 2>/dev/null || true' EXIT
node --input-type=module <<'JS'
const deadline = Date.now() + 15000
while (true) {
  try { if ((await fetch('http://127.0.0.1:4173')).ok) break } catch {}
  if (Date.now() > deadline) throw new Error('Preview did not become ready')
  await new Promise(resolve => setTimeout(resolve, 100))
}
JS
node tests/e2e.mjs
SKILL_ACTIONS_BASE_URL=http://127.0.0.1:4173 node tests/skill-actions.mjs
SKILL_DISPLAY_NAME_BASE_URL=http://127.0.0.1:4173 node tests/skill-display-name.mjs
