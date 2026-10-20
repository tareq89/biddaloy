#!/bin/sh
# Mounted into /docker-entrypoint.d/, where nginx's stock entrypoint runs it
# (alongside the envsubst templating step) before starting nginx itself.
#
# A rotated Origin CA pair on the host mount can't signal this container,
# so nginx reloads itself periodically instead — a no-op if the cert hasn't changed,
# and how a renewed cert actually gets picked up without downtime.
set -e

(
  while :; do
    sleep 6h
    nginx -s reload
  done
) &
