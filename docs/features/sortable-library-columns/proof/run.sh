#!/usr/bin/env bash
set -euo pipefail

feature_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$feature_dir/../../.." && pwd)"
frontend_dir="$repo_root/frontend/app"
proof_tmp="$(mktemp -d)"
preview_port=4194

cleanup() {
  if [[ -n "${preview_pid:-}" ]]; then
    kill "$preview_pid" 2>/dev/null || true
    wait "$preview_pid" 2>/dev/null || true
  fi
  rm -rf "$proof_tmp"
}
trap cleanup EXIT

printf 'frontend=%s\n' "$frontend_dir"
printf 'node=%s\n' "$(node --version)"
printf 'preview=http://127.0.0.1:%s\n' "$preview_port"

cd "$frontend_dir"
pnpm run build
pnpm exec vite preview --host 127.0.0.1 --port "$preview_port" >"$proof_tmp/preview.log" 2>&1 &
preview_pid=$!

for _ in {1..40}; do
  if curl --fail --silent "http://127.0.0.1:$preview_port" >/dev/null; then
    break
  fi
  sleep 0.25
done

if ! curl --fail --silent "http://127.0.0.1:$preview_port" >/dev/null; then
  cat "$proof_tmp/preview.log"
  exit 1
fi

PROOF_BASE_URL="http://127.0.0.1:$preview_port" node "$feature_dir/proof/ui.mjs"
