#!/usr/bin/env bash
# Runs the demo rebuild ONCE and exits (D11): exit 0 on success, non-zero with `FAILED at <step>` or a
# reset.sh error otherwise. The schedule lives on the host (a systemd timer), which restarts the app
# after a successful run; this container has no cron and no Docker access.
#   no args / --now  -> /app/reset.sh [--now]
#   a command        -> that command (e.g. `docker compose ... run --rm demo-reset /app/reset.sh --now`)
set -euo pipefail

if [[ $# -gt 0 && "$1" != -* ]]; then exec "$@"; fi
exec /app/reset.sh "$@"
