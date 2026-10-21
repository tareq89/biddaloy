#!/usr/bin/env bash
# [50 #2730, 79.0] Landing server blocks: the apex proxies to the landing container (the
# static site, its CSP and cache headers belong to that image), www redirects to the apex,
# an unknown host is dropped. Run in both edge modes. Same harness as
# hardening.infra.test.sh. Needs docker only.
#   bash nginx/test/landing.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=landing-test
VOL=landing-test-le
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.98.10
FAILS=0

cleanup() {
  docker rm -f landing-upstream landing-stub landing-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.98.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# Stubs: the landing container (what `landing` resolves to) and an app upstream.
stub() { # <name> <alias> <port> <reply>
  docker run -d --name "$1" --network "$NET" --network-alias "$2" --entrypoint sh "$NGINX_IMG" \
    -c "echo 'server { listen $3; location / { default_type text/plain; return 200 \"$4\"; } }' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null
}
stub landing-stub landing 80 landing-ok
stub landing-upstream prod-app 3000 app-ok

docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1

start_edge() { # <mode>
  docker rm -f landing-edge >/dev/null 2>&1 || true
  docker run -d --name landing-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$1" \
    -e EDGE_TRUSTED_CIDR=172.30.98.0/24 -e APP_DOMAIN=example.test -e LANDING_DOMAIN=landing.test -e OPS_UPSTREAM_HOST= \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
    -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec landing-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

# hdrs <url-scheme> <host> <path>: response headers (CRs stripped). Empty on a dropped request.
hdrs() { docker run --rm --network "$NET" "$CURL_IMG" -skI --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" | tr -d '\r' || true; }
body() { docker run --rm --network "$NET" "$CURL_IMG" -sk --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }
code() { docker run --rm --network "$NET" "$CURL_IMG" -sk -o /dev/null -w '%{http_code}' --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }

# --- tunnel mode: everything over plain HTTP on :80 ---
start_edge tunnel
docker exec landing-edge nginx -t >/dev/null 2>&1 && pass "tunnel: nginx -t" || fail "tunnel: nginx -t" "non-zero"
conf=$(docker exec landing-edge nginx -T 2>/dev/null | tr -s ' ')
[[ "$conf" == *"server_name landing.test;"* && "$conf" == *"server_name www.landing.test;"* ]] \
  && pass "nginx -T includes the landing blocks" || fail "nginx -T includes the landing blocks" "missing"

b=$(body http landing.test /bn/)
[ "$b" = landing-ok ] && pass "tunnel: apex proxies to the landing container" || fail "tunnel: apex" "$b"

h=$(hdrs http www.landing.test '/bn/?x=1')
grep -q ' 301' <<<"$h" && grep -qi '^location: https://landing.test/bn/?x=1' <<<"$h" \
  && pass "tunnel: www -> 301 apex over https, path and query kept" || fail "tunnel: www redirect" "$h"

c=$(code http other.test /bn/)
[ "$c" = 000 ] && pass "tunnel: unknown host dropped" || fail "tunnel: unknown host" "$c"

# --- direct mode: :80 redirects, :443 serves ---
start_edge direct
docker exec landing-edge nginx -t >/dev/null 2>&1 && pass "direct: nginx -t" || fail "direct: nginx -t" "non-zero"

b=$(body https landing.test /bn/)
[ "$b" = landing-ok ] && pass "direct: apex over https proxies to the landing container" || fail "direct: apex" "$b"

h=$(hdrs http landing.test /bn/)
grep -q ' 301' <<<"$h" && grep -qi '^location: https://landing.test/bn/' <<<"$h" \
  && pass "direct: http -> 301 https" || fail "direct: http redirect" "$h"

h=$(hdrs https www.landing.test '/bn/?x=1')
grep -q ' 301' <<<"$h" && grep -qi '^location: https://landing.test/bn/?x=1' <<<"$h" \
  && pass "direct: www -> 301 apex" || fail "direct: www redirect" "$h"

c=$(code https other.test /bn/)
[ "$c" = 000 ] && pass "direct: unknown host dropped (handshake rejected)" || fail "direct: unknown host" "$c"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
