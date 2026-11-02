#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
export PYTHONDONTWRITEBYTECODE=1
exec .venv/bin/python docs/verification/review-history/proof/runtime.py
