#!/usr/bin/env bash
# Builds a crontab from BACKUP_SCHEDULE and hands off to supercronic in the
# foreground. Split from backup.sh so backup.sh stays a single self-contained
# script an operator can also run by hand (e.g. for a manual off-schedule
# backup, or in the restore-drill workflow).
set -euo pipefail

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"

# BACKUP_SCHEDULE is written verbatim into the crontab below. A stray
# extra field, shell metacharacter, or embedded newline would let it inject
# another cron entry or command — the cron runner would then run it with
# backup credentials. Accept exactly one five-field cron expression (each
# field: digits, `*`, `,`, `-`, `/`) and nothing else.
cron_field='[0-9*/,-]+'
if ! [[ "$BACKUP_SCHEDULE" =~ ^${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}[[:space:]]+${cron_field}$ ]]; then
  echo "entrypoint.sh: BACKUP_SCHEDULE must be a single five-field cron expression, got '${BACKUP_SCHEDULE}'" >&2
  exit 1
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

# supercronic gives every job its own (the container's) environment, so
# the crontab holds the schedule only — no secret is ever written to a file.
# Job output goes to the container log (`docker compose logs backup`).
printf '%s /app/backup.sh\n' "$BACKUP_SCHEDULE" > /app/crontab

echo "entrypoint.sh: starting supercronic with schedule '${BACKUP_SCHEDULE}' (TZ=${TZ:-unset})"
exec supercronic /app/crontab
