#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 15-edge-mode.sh, so nginx's stock
# entrypoint runs it before 20-envsubst-on-templates.sh (and before nginx).
#
# Reads EDGE_MODE and writes the parts of the config that differ between the two
# ways the origin can be reached (Epic 79.0, D8):
#
#   tunnel  cloudflared dials in over the `biddaloy-edge` network, plain HTTP on :80.
#           The visitor address comes from CF-Connecting-IP, but only from the trusted
#           subnet (EDGE_TRUSTED_CIDR, else detected); no TLS lines, no basic auth
#           (Cloudflare Access is the outer login, checked by cloudflared). The app is told
#           the public scheme is https.
#   direct  80/443 are published. Let's Encrypt certificate, :80 only answers ACME and
#           redirects, the visitor address is the TCP peer (no real_ip lines at all),
#           protected hosts ask for basic auth ($basic_auth), HSTS on.
#
# Output (the templates include/read these):
#   conf.d/00-edge.conf               $basic_auth, $edge_redirect, $edge_proto, $edge_hsts,
#                                     resolver (+ real_ip in tunnel)
#   snippets/edge-server.conf         inside every named server: TLS listen + ACME + :80 redirect
#   snippets/edge-default.conf        inside the catch-all server: TLS handshake reject
#
# Any bad value stops the container: a loud failure beats a silently wrong trust model.
set -eu

ROOT="${EDGE_CONF_ROOT:-/etc/nginx}"
MODE="${EDGE_MODE:-}"

die() {
  echo "edge-mode.sh: $*" >&2
  exit 1
}

case "$MODE" in
tunnel | direct) ;;
*) die "EDGE_MODE must be tunnel or direct (got '$MODE')" ;;
esac

mkdir -p "$ROOT/conf.d" "$ROOT/snippets"
CONF="$ROOT/conf.d/00-edge.conf"
SERVER="$ROOT/snippets/edge-server.conf"
DEFAULT="$ROOT/snippets/edge-default.conf"

# Docker's embedded DNS: upstreams with `resolve` re-look-up their names, so nginx boots
# when a container (staging, the second app, ops) is not up yet.
RESOLVER='resolver 127.0.0.11 valid=10s ipv6=off;'

# net_of <ip> <prefix> -> network address, e.g. 172.18.0.5 16 -> 172.18.0.0
net_of() {
  printf '%s\n' "$1" | awk -F. -v p="$2" '{
    for (i = 1; i <= 4; i++) {
      b = p - (i - 1) * 8; if (b > 8) b = 8; if (b < 0) b = 0
      blk = 2 ^ (8 - b); n = $i - ($i % blk)
      printf "%s%d", (i > 1 ? "." : ""), n
    }
    print ""
  }'
}

if [ "$MODE" = tunnel ]; then
  if [ -n "${EDGE_TRUSTED_CIDR:-}" ]; then
    # Explicit and pinned by the deploy (the biddaloy-edge subnet): the safest source.
    case "$EDGE_TRUSTED_CIDR" in
    *[!0-9./]*) die "invalid EDGE_TRUSTED_CIDR '$EDGE_TRUSTED_CIDR'" ;;
    esac
    printf '%s\n' "$EDGE_TRUSTED_CIDR" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' ||
      die "invalid EDGE_TRUSTED_CIDR '$EDGE_TRUSTED_CIDR'"
    subnet=$EDGE_TRUSTED_CIDR
  else
    # Detect: the interface on the same network as `cloudflared` when that name resolves,
    # else eth0. The real prefix is kept (never widened to /16).
    cf=$(getent hosts cloudflared 2>/dev/null | awk '{print $1; exit}' || true)
    subnet=
    for cidr in $(ip -o -f inet addr show | awk '$2 != "lo" {print $4}'); do
      ip4=${cidr%/*}
      pre=${cidr#*/}
      net=$(net_of "$ip4" "$pre")
      if [ -n "$cf" ] && [ "$(net_of "$cf" "$pre")" = "$net" ]; then
        subnet="$net/$pre"
        break
      fi
    done
    if [ -z "$subnet" ]; then
      cidr=$(ip -o -f inet addr show eth0 | awk '{print $4; exit}')
      ip4=${cidr%/*}
      printf '%s\n' "$ip4" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' ||
        die "cannot read the IPv4 address of eth0 (got '$cidr')"
      subnet="$(net_of "$ip4" "${cidr#*/}")/${cidr#*/}"
    fi
  fi
  cat >"$CONF" <<EOF
# Written by edge-mode.sh (EDGE_MODE=tunnel). Do not edit.
$RESOLVER
set_real_ip_from $subnet;
real_ip_header CF-Connecting-IP;
map \$host \$basic_auth { default off; }
map \$host \$edge_redirect { default 0; }
# cloudflared talks plain HTTP to us, but visitors use https: the app must see https.
map \$host \$edge_proto { default https; }
map \$host \$edge_hsts { default ""; }
EOF
  echo "# EDGE_MODE=tunnel: plain HTTP on :80, nothing to add." >"$SERVER"
  echo "# EDGE_MODE=tunnel: nothing to add." >"$DEFAULT"
else
  domain="${APP_DOMAIN:-}"
  case "$domain" in
  '' | *[!A-Za-z0-9.-]* | .* | *. | -*) die "APP_DOMAIN must be set to a host name in direct mode (got '$domain')" ;;
  esac
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
map \$scheme \$edge_proto { default \$scheme; }
map \$scheme \$edge_hsts { default ""; https "max-age=31536000"; }
EOF
  cat >"$SERVER" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
listen 443 ssl;
http2 on;
ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
# auth_basic off: the challenge must work on protected hosts too (certbot has no login).
location ^~ /.well-known/acme-challenge/ { auth_basic off; root /var/www/acme; }
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
