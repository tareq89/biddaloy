# syntax=docker/dockerfile:1
#
# Runs reset.sh once per start (the host timer schedules it). It is the app image plus the tools reset.sh needs: the
# migrations, the seed, the validator and a temporary server all run from the app's own
# compiled code (server/dist), so nothing here drifts from what the demo serves.
# `app` and `backup` are named build contexts, passed by docker-compose.build.yml and
# .github/workflows/publish-image.yml, so this image always sits on top of the app image.
FROM app

USER root
# postgresql18-client (psql), aws-cli (S3 cleanup), redis (redis-cli), flock (one reset at a time).
# No docker-cli and no cron: the host timer restarts the app after a good run (D11).
RUN apk add --no-cache bash postgresql18-client aws-cli redis curl flock tzdata

ENV TZ=Asia/Dhaka

COPY --chown=app:nodejs reset.sh entrypoint.sh /app/
# The one swap script, from the second build context `backup` (= scripts/backup). No second copy exists.
COPY --from=backup --chown=app:nodejs db-swap.sh /app/db-swap.sh
RUN chmod +x /app/reset.sh /app/entrypoint.sh /app/db-swap.sh

# Stays root to write the demo-state volume (its owner depends on which container created it).
# No docker socket here and no DOCKER_HOST.
ENTRYPOINT ["/app/entrypoint.sh"]
