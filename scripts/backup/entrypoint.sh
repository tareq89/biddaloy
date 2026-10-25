#!/usr/bin/env bash
# Builds a crontab from BACKUP_SCHEDULE and hands off to supercronic in the
# foreground. Split from backup.sh so backup.sh stays a single self-contained
# script an operator can also run by hand (e.g. for a manual off-schedule
# backup).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_PUBLIC_KEY:?BACKUP_AGE_PUBLIC_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

# R2 settings are a set: all six or none (none = legacy S3_* mode, see backup.sh).
r2_set=0
for v in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_RCLONE_CRYPT_PASSWORD BACKUP_RCLONE_CRYPT_SALT; do
  if [[ -n "${!v:-}" ]]; then r2_set=$((r2_set + 1)); fi
done
if [[ $r2_set -ne 0 && $r2_set -ne 6 ]]; then
  echo "entrypoint.sh: BACKUP_S3_* and BACKUP_RCLONE_CRYPT_* must be set together (all six or none)" >&2
  exit 1
fi
# A copied .env.example placeholder (change-me) or a short secret would
# encrypt every file with a guessable password: refuse to start. backup.sh
# repeats this check for manual runs. The value is never printed.
if [[ $r2_set -eq 6 ]]; then
  for v in BACKUP_S3_SECRET_ACCESS_KEY BACKUP_RCLONE_CRYPT_PASSWORD BACKUP_RCLONE_CRYPT_SALT; do
    val="${!v}"
    if [[ "$val" == *change-me* || ${#val} -lt 16 ]]; then
      echo "entrypoint.sh: ${v} is a placeholder or shorter than 16 characters" >&2
      exit 1
    fi
  done
  unset val
fi

# Default cadence: hourly in R2 mode, once a day (02:00) in legacy mode, where
# every dump stays on the same host disk as the database.
if [[ $r2_set -eq 6 ]]; then default_schedule='0 * * * *'; else default_schedule='0 2 * * *'; fi
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-$default_schedule}"

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
# supercronic gives every job its own (the container's) environment, so
# the crontab holds the schedule only — no secret is ever written to a file.
# Job output goes to the container log (`docker compose logs backup`).
printf '%s /app/backup.sh\n' "$BACKUP_SCHEDULE" > /app/crontab

echo "entrypoint.sh: starting supercronic with schedule '${BACKUP_SCHEDULE}' (TZ=${TZ:-unset})"
exec supercronic /app/crontab
