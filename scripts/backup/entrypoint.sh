#!/usr/bin/env bash
# Builds a crontab from BACKUP_SCHEDULE and hands off to crond in the
# foreground. Split from backup.sh so backup.sh stays a single self-contained
# script an operator can also run by hand (e.g. for a manual off-schedule
# backup, or in the restore-drill workflow).
set -euo pipefail

BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"

# crond does not inherit the container's environment, so each secret
# backup.sh needs is written into the crontab's command line, resolved
# from this process's env right now (entrypoint start, before crond takes
# over) via `env KEY="$VALUE" ...`. The crontab file (/etc/crontabs/root,
# root-only, 0600 by convention) holds the resolved values — that's normal
# crond practice, not a log — and nothing here is printed to stdout/stderr,
# which is what "never echo a secret" is actually guarding against.
{
  echo "TZ=Asia/Dhaka"
  printf '%s env DATABASE_URL=%q BACKUP_AGE_PUBLIC_KEY=%q S3_BUCKET=%q S3_ENDPOINT=%q S3_REGION=%q S3_ACCESS_KEY_ID=%q S3_SECRET_ACCESS_KEY=%q BACKUP_RETENTION_DAYS=%q SENTRY_CRON_MONITOR_URL=%q /app/backup.sh >> /var/log/backup.log 2>&1\n' \
    "$BACKUP_SCHEDULE" \
    "${DATABASE_URL:-}" "${BACKUP_AGE_PUBLIC_KEY:-}" "${S3_BUCKET:-}" "${S3_ENDPOINT:-}" \
    "${S3_REGION:-}" "${S3_ACCESS_KEY_ID:-}" "${S3_SECRET_ACCESS_KEY:-}" \
    "${BACKUP_RETENTION_DAYS:-30}" "${SENTRY_CRON_MONITOR_URL:-}"
} > /etc/crontabs/root
chmod 600 /etc/crontabs/root

# crond needs the log file to exist before it can append to it.
touch /var/log/backup.log

echo "entrypoint.sh: starting crond with schedule '${BACKUP_SCHEDULE}' (TZ=Asia/Dhaka)"
exec crond -f -l 8
