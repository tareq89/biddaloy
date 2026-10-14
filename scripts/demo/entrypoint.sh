#!/usr/bin/env bash
# Builds a crontab from DEMO_RESET_SCHEDULE and hands off to supercronic in the foreground.
# Split from reset.sh so reset.sh stays a script an operator can also run by hand.
# Default 01:00 (TZ Asia/Dhaka): the build takes a while, then reset.sh waits for 02:00 to swap.
set -euo pipefail

DEMO_RESET_SCHEDULE="${DEMO_RESET_SCHEDULE:-0 1 * * *}"

# Written verbatim into the crontab: accept exactly one five-field cron expression, so a stray
# field or newline cannot add a second cron entry (same rule as scripts/backup/entrypoint.sh).
cron_field='[0-9*/,-]+'
if ! [[ "$DEMO_RESET_SCHEDULE" =~ ^${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}$ ]]; then
  echo "entrypoint.sh: DEMO_RESET_SCHEDULE must be a single five-field cron expression, got '${DEMO_RESET_SCHEDULE}'" >&2
  exit 1
fi

# Manual run: `docker compose ... run --rm demo-reset /app/reset.sh --now` overrides the entrypoint's
# command, so it never reaches this file's crontab path.
if [[ $# -gt 0 ]]; then exec "$@"; fi

printf '%s /app/reset.sh\n' "$DEMO_RESET_SCHEDULE" > /tmp/crontab
echo "entrypoint.sh: starting supercronic with schedule '${DEMO_RESET_SCHEDULE}' (TZ=${TZ:-unset})"
exec supercronic /tmp/crontab
