#!/usr/bin/env bash
set -euo pipefail

feature_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$feature_dir/../../.." && pwd)"
frontend_dir="$repo_root/frontend/app"
proof_tmp="$(mktemp -d)"

cleanup_runtime() {
  if [[ -n "${preview_pid:-}" ]]; then
    kill "$preview_pid" 2>/dev/null || true
    wait "$preview_pid" 2>/dev/null || true
    preview_pid=""
  fi
  if [[ -n "${backend_pid:-}" ]]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
    backend_pid=""
  fi
}

cleanup() {
  cleanup_runtime
  rm -rf "$proof_tmp"
}
trap cleanup EXIT

free_port() {
  "$repo_root/.venv/bin/python" -c 'import socket; sock=socket.socket(); sock.bind(("127.0.0.1", 0)); print(sock.getsockname()[1]); sock.close()'
}

wait_ready() {
  local url="$1"
  local log_path="$2"
  for _ in {1..60}; do
    if curl --fail --silent "$url" >/dev/null; then
      return
    fi
    sleep 0.25
  done
  cat "$log_path"
  return 1
}

run_mode() {
  local mode="$1"
  local backend_port
  local frontend_port
  local state_dir="$proof_tmp/$mode"
  backend_port="$(free_port)"
  frontend_port="$(free_port)"
  mkdir -p "$state_dir"

  echo "Mode: $mode"
  echo "Database: $state_dir/registry.sqlite3"
  echo "Git mirror: $state_dir/registry-git"
  PROOF_MODE="$mode" \
    PROOF_BACKEND_PORT="$backend_port" \
    PROOF_FRONTEND_URL="http://127.0.0.1:$frontend_port" \
    PROOF_STATE_DIR="$state_dir" \
    PYTHONPATH="$repo_root" \
    PYTHONDONTWRITEBYTECODE=1 \
    "$repo_root/.venv/bin/python" "$feature_dir/proof/runtime.py" \
    >"$state_dir/backend.log" 2>&1 &
  backend_pid=$!
  wait_ready "http://127.0.0.1:$backend_port/health" "$state_dir/backend.log"

  cd "$frontend_dir"
  BACKEND_URL="http://127.0.0.1:$backend_port" \
    pnpm --config.verify-deps-before-run=false exec vite preview --host 127.0.0.1 --port "$frontend_port" --strictPort \
    >"$state_dir/frontend.log" 2>&1 &
  preview_pid=$!
  wait_ready "http://127.0.0.1:$frontend_port" "$state_dir/frontend.log"
  echo "Frontend: http://127.0.0.1:$frontend_port"
  echo "Backend: http://127.0.0.1:$backend_port"

  PROOF_MODE="$mode" \
    PROOF_FRONTEND_URL="http://127.0.0.1:$frontend_port" \
    node "$feature_dir/proof/ui.mjs"
  cleanup_runtime

  PROOF_MODE="$mode" PROOF_STATE_DIR="$state_dir" \
    "$repo_root/.venv/bin/python" "$feature_dir/proof/verify_state.py"
}

cd "$repo_root"
echo "Python: $(.venv/bin/python --version 2>&1)"
echo "Flask: $(.venv/bin/python -c 'import flask; print(flask.__version__)' 2>/dev/null || echo installed)"
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Browser: Playwright Chromium"
cd "$frontend_dir"
pnpm --config.verify-deps-before-run=false run build

backend_pid=""
preview_pid=""
run_mode open
run_mode google
PROOF_STATE_DIR="$proof_tmp/recovery" PYTHONPATH="$repo_root" PYTHONDONTWRITEBYTECODE=1 \
  "$repo_root/.venv/bin/python" "$feature_dir/proof/recovery.py"
