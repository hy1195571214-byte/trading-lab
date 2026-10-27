#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$TASK_ROOT/work/cloudflare-config" "$TASK_ROOT/work/cloudflare-logs"
cd "$TASK_ROOT/cloudflare"
exec env XDG_CONFIG_HOME="$TASK_ROOT/work/cloudflare-config" WRANGLER_LOG_PATH="$TASK_ROOT/work/cloudflare-logs/wrangler.log" WRANGLER_SEND_METRICS=false node node_modules/wrangler/bin/wrangler.js "$@"
