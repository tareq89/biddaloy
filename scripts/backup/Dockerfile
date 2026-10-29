# syntax=docker/dockerfile:1
#
# Runs backup.sh on a cron schedule inside the compose network. Alpine +
# postgresql-client (pg_dump/pg_restore), age (encryption), aws-cli
# (S3-compatible upload), and supercronic (a cron runner that works as a
# non-root user and hands its own environment to jobs, unlike busybox crond,
# which needs root and drops the container env — forcing secrets into a file).
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

RUN apk add --no-cache \
  bash \
  postgresql18-client \
  age \
  aws-cli \
  rclone \
  tzdata \
  flock \
  curl \
  supercronic

ENV TZ=Asia/Dhaka

WORKDIR /app
COPY *.sh *.sql /app/
# Crontab (schedule only, no secrets) is generated at container start
# (entrypoint.sh) from BACKUP_SCHEDULE.
RUN chmod +x /app/*.sh \
  && addgroup -S -g 10001 backup \
  && adduser -S -D -u 10001 -G backup -h /home/backup backup \
  && chown -R backup:backup /app

USER backup

ENTRYPOINT ["/app/entrypoint.sh"]
