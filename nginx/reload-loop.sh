#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 99-reload-loop.sh, where nginx's stock
# entrypoint runs it after the envsubst templating step and before nginx itself.
#
# 1. Ops-less hosts: when OPS_UPSTREAM_HOST is empty the ops UIs run on another host,
#    so their server blocks are not wanted (edge-mode.sh runs too early to drop them).
# 2. Reloads: nginx cannot be signalled from outside, so it reloads itself
#      - when the flag file changes (certbot touches it after a renewal, direct mode), and
#      - every 6 h anyway: a no-op if nothing changed, and how a renewed cert is picked up
#        even if the flag was missed.
set -e

[ -n "${OPS_UPSTREAM_HOST:-}" ] || rm -f /etc/nginx/conf.d/ops.conf

FLAG="${RELOAD_FLAG:-/etc/letsencrypt/.reload}"
POLL="${RELOAD_POLL_SECONDS:-60}"
EVERY="${RELOAD_EVERY_SECONDS:-21600}"

(
  last=$(stat -c %Y "$FLAG" 2>/dev/null || echo 0)
  waited=0
  while :; do
    sleep "$POLL"
    waited=$((waited + POLL))
    now=$(stat -c %Y "$FLAG" 2>/dev/null || echo 0)
    if [ "$now" != "$last" ] || [ "$waited" -ge "$EVERY" ]; then
      last=$now
      waited=0
      nginx -s reload || echo "reload-loop: reload failed" >&2
    fi
  done
) &
