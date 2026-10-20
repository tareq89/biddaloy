# syntax=docker/dockerfile:1
#
# Runs backup.sh on a cron schedule inside the compose network. Alpine +
# postgresql-client (pg_dump/pg_restore), age (encryption), aws-cli
# (S3-compatible upload), and supercronic (a cron runner that works as a
# non-root user and hands its own environment to jobs, unlike busybox crond,
# which needs root and drops the container env — forcing secrets into a file).
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

RUN apk add --no-cache \
  bash \
  postgresql18-client \
  age \
  aws-cli \
  rclone \
  tzdata \
  curl \
  supercronic

ENV TZ=Asia/Dhaka

WORKDIR /app
COPY backup.sh /app/backup.sh
COPY restore.sh /app/restore.sh
COPY verify.sql /app/verify.sql
# Crontab (schedule only, no secrets) is generated at container start
# (entrypoint.sh) from BACKUP_SCHEDULE.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/backup.sh /app/restore.sh /app/entrypoint.sh \
  && addgroup -S -g 10001 backup \
  && adduser -S -D -u 10001 -G backup -h /home/backup backup \
  && chown -R backup:backup /app

USER backup

ENTRYPOINT ["/app/entrypoint.sh"]
