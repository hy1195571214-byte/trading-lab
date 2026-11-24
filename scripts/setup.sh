#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_ROOT"
TASK_LOCAL_DIR="${TRADING_LAB_LOCAL_DIR:-$HOME/Library/Application Support/Trading Lab}"
TASK_FRONTEND_DEPS="$TASK_LOCAL_DIR/frontend-dependencies"
mkdir -p "$TASK_LOCAL_DIR/cache/pip" "$TASK_LOCAL_DIR/cache/npm" "$TASK_FRONTEND_DEPS" work
python3 -m venv "$TASK_LOCAL_DIR/.venv"
PIP_CACHE_DIR="$TASK_LOCAL_DIR/cache/pip" "$TASK_LOCAL_DIR/.venv/bin/python" -m pip install -r backend/requirements.txt
cp frontend/package.json frontend/package-lock.json "$TASK_FRONTEND_DEPS/"
npm --prefix "$TASK_FRONTEND_DEPS" ci --cache "$TASK_LOCAL_DIR/cache/npm"
if [[ -e frontend/node_modules && ! -L frontend/node_modules ]]; then
  mv frontend/node_modules "work/node-modules-before-local-$(date +%s)"
fi
ln -sfn "$TASK_FRONTEND_DEPS/node_modules" frontend/node_modules
echo 'Ready. Run ./scripts/dev.sh, then open http://127.0.0.1:5173.'
