#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_ROOT"
TASK_PYTHON="${PYTHON_BIN:-$TASK_ROOT/.venv/bin/python}"
if [[ ! -x "$TASK_PYTHON" || ! -d frontend/node_modules ]]; then
  echo 'Install dependencies first: ./scripts/setup.sh' >&2
  exit 1
fi
exec "$TASK_PYTHON" scripts/dev.py

