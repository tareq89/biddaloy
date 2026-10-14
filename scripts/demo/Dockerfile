# syntax=docker/dockerfile:1
#
# Runs reset.sh on a cron schedule. It is the app image plus the tools reset.sh needs: the
# migrations, the seed, the validator and a temporary server all run from the app's own
# compiled code (server/dist), so nothing here drifts from what the demo serves.
# Built by docker-compose.demo.yml with APP_IMAGE=biddaloy-app (the `app` service's image).
ARG APP_IMAGE=biddaloy-app
FROM ${APP_IMAGE}

USER root
# postgresql18-client (psql), aws-cli (S3 cleanup), redis (redis-cli), docker-cli (restart the
# app container), supercronic (cron as non-root, hands its env to jobs; same as scripts/backup).
RUN apk add --no-cache bash postgresql18-client aws-cli redis docker-cli curl tzdata supercronic

ENV TZ=Asia/Dhaka

COPY --chown=app:nodejs reset.sh entrypoint.sh /app/
RUN chmod +x /app/reset.sh /app/entrypoint.sh

# Stays root: restarting the app container needs the docker socket, whose group differs per host.
ENTRYPOINT ["/app/entrypoint.sh"]
