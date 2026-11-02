#!/usr/bin/env bash
set -euo pipefail

feature_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$feature_dir/../../.." && pwd)"
proof_tmp="$(mktemp -d)"
project="skills-registry-transfer-proof-$(date +%s)-$$"
frontend_port=4198
provider_port=4199
origin="http://127.0.0.1:$frontend_port"

cleanup() {
  docker compose --env-file "$proof_tmp/empty.env" -p "$project" -f "$repo_root/deployment/prod/compose.yaml" -f "$proof_tmp/override.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$proof_tmp"
}
trap cleanup EXIT

touch "$proof_tmp/empty.env"
mkdir -p "$proof_tmp/workspace"
cat >"$proof_tmp/override.yaml" <<YAML
services:
  backend:
    environment:
      HOST_WORKSPACE_PATH: $proof_tmp/workspace
    volumes: !override
      - $proof_tmp/workspace:/workspace
  frontend:
    ports: !override
      - 127.0.0.1:$frontend_port:80
YAML

cd "$repo_root"
export COMPOSE_DISABLE_ENV_FILE=1
docker compose --env-file "$proof_tmp/empty.env" -p "$project" -f "$repo_root/deployment/prod/compose.yaml" -f "$proof_tmp/override.yaml" up --build --detach --wait
docker compose --env-file "$proof_tmp/empty.env" -p "$project" -f "$repo_root/deployment/prod/compose.yaml" -f "$proof_tmp/override.yaml" \
  exec -T frontend nginx -T 2>&1 | grep -q 'client_max_body_size 128m;'

curl --fail --silent --show-error \
  -H "Origin: $origin" \
  -H 'Content-Type: application/json' \
  --data "{\"auth_mode\":\"none\",\"public_url\":\"$origin\",\"git_repository\":{\"name\":\"registry-git\"}}" \
  "$origin/api/setup" >/dev/null

echo "Production portal: $origin"
echo "Browser: Playwright Chromium"
PROOF_BASE_URL="$origin" node "$feature_dir/proof/ui.mjs"

PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider \
  tests/test_skill_archive.py \
  tests/test_first_run_setup.py::test_open_mcp_accepts_large_complete_binary_bundles_and_declares_encoding \
  tests/test_first_run_setup.py::test_mcp_rejects_invalid_binary_contract_without_mutation \
  tests/test_first_run_setup.py::test_mcp_retains_application_owned_bundle_safety_caps \
  tests/test_first_run_setup.py::test_mcp_rejects_file_ancestor_collision_before_persistence \
  tests/test_first_run_setup.py::test_flask_transport_ceiling_is_above_reported_bundle \
  tests/test_oidc_registry.py::test_authenticated_mcp_submit_and_proposal_edit_preserve_binary_assets \
  -q

binary_hex="$(od -An -tx1 "$proof_tmp/workspace/registry-git/skills/mcp-complete-assets/assets/model.bin" | tr -d ' \n')"
test "$binary_hex" = "00ff1042494e"

docker compose --env-file "$proof_tmp/empty.env" -p "$project" -f "$repo_root/deployment/prod/compose.yaml" -f "$proof_tmp/override.yaml" down --volumes --remove-orphans

mkdir -p "$proof_tmp/google-workspace"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python "$feature_dir/proof/google_state.py" \
  seed \
  "$proof_tmp/google-workspace/registry.sqlite3" \
  "$origin" \
  "$proof_tmp/google-workspace/registry-git"

cat >"$proof_tmp/override.yaml" <<YAML
services:
  backend:
    environment:
      HOST_WORKSPACE_PATH: $proof_tmp/google-workspace
      PUBLIC_URL: $origin
      GOOGLE_CLIENT_ID: proof-client
      GOOGLE_CLIENT_SECRET: proof-secret-canary
      ALLOWED_GOOGLE_DOMAINS: example.com
      ADMIN_EMAILS: admin@example.com
      GOOGLE_ISSUER: http://fake-google:9000
      GOOGLE_AUTHORIZATION_ENDPOINT: http://127.0.0.1:$provider_port/authorize
      GOOGLE_TOKEN_ENDPOINT: http://fake-google:9000/token
      GOOGLE_JWKS_URL: http://fake-google:9000/jwks
    volumes: !override
      - $proof_tmp/google-workspace:/workspace
  frontend:
    ports: !override
      - 127.0.0.1:$frontend_port:80
  fake-google:
    build:
      context: $repo_root
      dockerfile: backend/Dockerfile
    command: python /proof/fake_google.py
    environment:
      PROOF_GOOGLE_ISSUER: http://fake-google:9000
      PROOF_GOOGLE_CLIENT_ID: proof-client
      PROOF_GOOGLE_CLIENT_SECRET: proof-secret-canary
    ports:
      - 127.0.0.1:$provider_port:9000
    volumes:
      - $repo_root/docs/features/google-oidc-registry-access/proof:/proof:ro
YAML

docker compose --env-file "$proof_tmp/empty.env" -p "$project" -f "$repo_root/deployment/prod/compose.yaml" -f "$proof_tmp/override.yaml" up --build --detach --wait
echo "Production Google portal: $origin"
PROOF_FRONTEND_URL="$origin" \
  PROOF_PROVIDER_URL="http://127.0.0.1:$provider_port" \
  node "$feature_dir/proof/ui_google.mjs"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python "$feature_dir/proof/google_state.py" \
  assert \
  "$proof_tmp/google-workspace/registry.sqlite3" \
  "$origin" \
  "$proof_tmp/google-workspace/registry-git"
