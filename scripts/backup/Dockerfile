# syntax=docker/dockerfile:1
#
# Runs backup.sh on a cron schedule inside the compose network. Alpine +
# postgresql-client (pg_dump/pg_restore), age (encryption), aws-cli
# (S3-compatible upload), and busybox's crond (already in the base image).
FROM alpine:3.21

RUN apk add --no-cache \
  bash \
  postgresql16-client \
  age \
  aws-cli \
  tzdata \
  curl

WORKDIR /app
COPY backup.sh /app/backup.sh
COPY restore.sh /app/restore.sh
COPY verify.sql /app/verify.sql
RUN chmod +x /app/backup.sh /app/restore.sh

# Crontab is generated at container start (entrypoint.sh) from
# BACKUP_SCHEDULE, since crond needs the schedule baked into a crontab
# file rather than read from an env var directly.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
