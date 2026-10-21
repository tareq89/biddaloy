#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 15-edge-mode.sh, so nginx's stock
# entrypoint runs it before 20-envsubst-on-templates.sh (and before nginx).
#
# Reads EDGE_MODE and writes the parts of the config that differ between the two
# ways the origin can be reached (Epic 79.0, D8):
#
#   tunnel  cloudflared dials in over the `biddaloy-edge` network, plain HTTP on :80.
#           The visitor address comes from CF-Connecting-IP, but only from that
#           network's /16; no TLS lines, no basic auth (Cloudflare Access is the outer
#           login, checked by cloudflared).
#   direct  80/443 are published. Let's Encrypt certificate, :80 only answers ACME and
#           redirects, the visitor address is the TCP peer (no real_ip lines at all),
#           protected hosts ask for basic auth ($basic_auth).
#
# Output (the templates include/read these):
#   conf.d/00-edge.conf               $basic_auth, $edge_redirect, resolver (+ real_ip in tunnel)
#   snippets/edge-server.conf         inside every named server: TLS listen + ACME + :80 redirect
#   snippets/edge-default.conf        inside the catch-all server: TLS handshake reject
#
# Any other EDGE_MODE stops the container: a loud failure beats a silently wrong trust model.
set -eu

ROOT="${EDGE_CONF_ROOT:-/etc/nginx}"
MODE="${EDGE_MODE:-}"

case "$MODE" in
tunnel | direct) ;;
*)
  echo "edge-mode.sh: EDGE_MODE must be tunnel or direct (got '$MODE')" >&2
  exit 1
  ;;
esac

mkdir -p "$ROOT/conf.d" "$ROOT/snippets"
CONF="$ROOT/conf.d/00-edge.conf"
SERVER="$ROOT/snippets/edge-server.conf"
DEFAULT="$ROOT/snippets/edge-default.conf"

# Docker's embedded DNS: upstreams with `resolve` re-look-up their names, so nginx boots
# when a container (staging, the second app, ops) is not up yet.
RESOLVER='resolver 127.0.0.11 valid=10s ipv6=off;'

if [ "$MODE" = tunnel ]; then
  # Peer address of this container on its network, e.g. 172.18.0.5/16 -> 172.18.0.0/16.
  cidr=$(ip -o -f inet addr show eth0 | awk '{print $4; exit}')
  ip4=${cidr%/*}
  if ! printf '%s\n' "$ip4" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    echo "edge-mode.sh: cannot read the IPv4 address of eth0 (got '$cidr')" >&2
    exit 1
  fi
  subnet=$(printf '%s\n' "$ip4" | awk -F. '{print $1 "." $2 ".0.0/16"}')
  cat >"$CONF" <<EOF
# Written by edge-mode.sh (EDGE_MODE=tunnel). Do not edit.
$RESOLVER
set_real_ip_from $subnet;
real_ip_header CF-Connecting-IP;
map \$host \$basic_auth { default off; }
map \$host \$edge_redirect { default 0; }
EOF
  echo "# EDGE_MODE=tunnel: plain HTTP on :80, nothing to add." >"$SERVER"
  echo "# EDGE_MODE=tunnel: nothing to add." >"$DEFAULT"
else
  domain="${APP_DOMAIN:-}"
  if ! printf '%s\n' "$domain" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'; then
    echo "edge-mode.sh: APP_DOMAIN must be set to a host name in direct mode (got '$domain')" >&2
    exit 1
  fi
  cat >"$CONF" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
$RESOLVER
map \$host \$basic_auth { default "restricted"; }
# Plain HTTP is redirected to HTTPS, except the Let's Encrypt HTTP-01 challenge.
map "\$scheme:\$uri" \$edge_redirect {
    default 0;
    "~^http:/\.well-known/acme-challenge/" 0;
    "~^http:" 1;
}
EOF
  cat >"$SERVER" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
listen 443 ssl;
http2 on;
ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }
if (\$edge_redirect) { return 301 https://\$host\$request_uri; }
EOF
  cat >"$DEFAULT" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
listen 443 ssl default_server;
ssl_reject_handshake on;   # nginx >= 1.19.4; no certificate needed
EOF
fi

# Ops-less hosts (OPS_UPSTREAM_HOST empty): conf.d/ops.conf is removed by reload-loop.sh,
# which runs after the templates are rendered; this script runs before.
echo "edge-mode.sh: wrote $CONF (EDGE_MODE=$MODE)"
