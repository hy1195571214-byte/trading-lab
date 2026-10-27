#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_ROOT"
python3 -m venv .venv
mkdir -p work/dependency-cache/pip work/dependency-cache/npm
PIP_CACHE_DIR="$TASK_ROOT/work/dependency-cache/pip" .venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend install --cache "$TASK_ROOT/work/dependency-cache/npm"
echo 'Ready. Run ./scripts/dev.sh, then open http://127.0.0.1:5173.'

