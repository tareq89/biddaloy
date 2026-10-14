# syntax=docker/dockerfile:1
#
# Runs reset.sh on a cron schedule. It is the app image plus the tools reset.sh needs: the
# migrations, the seed, the validator and a temporary server all run from the app's own
# compiled code (server/dist), so nothing here drifts from what the demo serves.
# `app` is a named build context: docker-compose.demo.yml sets `additional_contexts: app:
# service:app`, so Compose builds the app image first and this one always sits on top of it.
FROM app

USER root
# postgresql18-client (psql), aws-cli (S3 cleanup), redis (redis-cli), docker-cli (restart the
# app container through the restart-only proxy), flock (one reset at a time), supercronic (cron
# that hands its env to jobs; same as scripts/backup).
RUN apk add --no-cache bash postgresql18-client aws-cli redis docker-cli curl flock tzdata supercronic

ENV TZ=Asia/Dhaka

COPY --chown=app:nodejs reset.sh entrypoint.sh /app/
RUN chmod +x /app/reset.sh /app/entrypoint.sh

# Stays root to write the demo-state volume (its owner depends on which container created it).
# No docker socket here: docker-compose.demo.yml points DOCKER_HOST at a restart-only proxy.
ENTRYPOINT ["/app/entrypoint.sh"]
