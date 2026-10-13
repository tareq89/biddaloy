#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 15-trusted-proxies.sh, so nginx's stock
# entrypoint runs it before 20-envsubst-on-templates.sh (and before nginx).
#
# Turns TRUSTED_PROXY_CIDRS (e.g. the Cloudflare ranges) into
# /etc/nginx/conf.d/00-trusted-proxies.conf:
#   - non-empty: when the TCP peer is inside one of those ranges, nginx takes
#     the visitor address from CF-Connecting-IP. Any other peer's header is
#     ignored, so a direct caller cannot spoof its IP.
#   - empty: no real-ip directives at all, i.e. exactly today's behaviour.
# Also defines $origin_allowed (1 = peer is a trusted proxy, loopback or a
# private range; 0 = anyone else). Nothing reads it yet; the origin lock-down
# ([75.5]) will.
#
# A bad entry stops the container: a loud failure beats a silently wrong
# trust list.
set -eu

OUT="${TRUSTED_PROXIES_OUT:-/etc/nginx/conf.d/00-trusted-proxies.conf}"
CIDRS=$(printf '%s' "${TRUSTED_PROXY_CIDRS:-}" | tr ',' ' ')

set -f # entries are never globs
for c in $CIDRS; do
  if printf '%s\n' "$c" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$' ||
    printf '%s\n' "$c" | grep -Eq '^[0-9A-Fa-f:]*:[0-9A-Fa-f:]*(/[0-9]{1,3})?$'; then
    continue
  fi
  echo "trusted-proxies.sh: invalid entry '$c' in TRUSTED_PROXY_CIDRS" >&2
  exit 1
done

if [ -z "$CIDRS" ]; then
  echo 'geo $realip_remote_addr $origin_allowed { default 1; }' >"$OUT"
else
  {
    for c in $CIDRS; do echo "set_real_ip_from $c;"; done
    echo "real_ip_header CF-Connecting-IP;"
    echo 'geo $realip_remote_addr $origin_allowed {'
    echo "  default 0;"
    for c in 127.0.0.0/8 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7 $CIDRS; do
      echo "  $c 1;"
    done
    echo "}"
  } >"$OUT"
fi
echo "trusted-proxies.sh: wrote $OUT"
