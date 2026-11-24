#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_ROOT"
TASK_LOCAL_DIR="${TRADING_LAB_LOCAL_DIR:-$HOME/Library/Application Support/Trading Lab}"
TASK_PYTHON="${PYTHON_BIN:-$TASK_LOCAL_DIR/.venv/bin/python}"
# Rebuild bytecode locally instead of waiting for cloud-only cache files.
export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-${TMPDIR:-/tmp}/trading-lab-pycache}"
if [[ ! -x "$TASK_PYTHON" || ! -d frontend/node_modules ]]; then
  echo 'Install dependencies first: ./scripts/setup.sh' >&2
  exit 1
fi
exec "$TASK_PYTHON" scripts/dev.py
