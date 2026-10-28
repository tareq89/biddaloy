#!/usr/bin/env bash
# [87.1.04] Test inbox server blocks: the demo inbox is public, noindex and has a Disallow-all
# robots.txt; the staging inbox sits behind the outer login (basic auth in direct mode);
# the `.invalid` defaults render a valid config; an unknown host is still dropped.
# Same harness as landing.infra.test.sh. Needs docker only.
#   bash nginx/test/inbox.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=inbox-test
VOL=inbox-test-le
AUTH=inbox-test-auth
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.99.10
FAILS=0

cleanup() {
  docker rm -f inbox-demo-stub inbox-staging-stub inbox-app-stub inbox-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" "$AUTH" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.99.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
docker volume create "$AUTH" >/dev/null

stub() { # <name> <alias> <port> <reply>
  docker run -d --name "$1" --network "$NET" --network-alias "$2" --entrypoint sh "$NGINX_IMG" \
    -c "echo 'server { listen $3; location / { default_type text/plain; return 200 \"$4\"; } }' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null
}
stub inbox-demo-stub demo-mailpit 8025 demo-inbox-ok
stub inbox-staging-stub staging-mailpit 8025 staging-inbox-ok
stub inbox-app-stub prod-app 3000 app-ok

docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1

# One basic-auth user (u:p), as the direct-mode edge mounts it.
docker run --rm -v "$AUTH:/auth" --entrypoint sh alpine/openssl -c 'echo "u:$(openssl passwd -apr1 p)" > /auth/htpasswd' >/dev/null

start_edge() { # <mode> [extra docker env args...]
  local mode="$1"; shift
  docker rm -f inbox-edge >/dev/null 2>&1 || true
  docker run -d --name inbox-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$mode" \
    -e EDGE_TRUSTED_CIDR=172.30.99.0/24 -e APP_DOMAIN=example.test -e LANDING_DOMAIN=landing.test -e OPS_UPSTREAM_HOST= "$@" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
    -v "$AUTH:/etc/nginx/auth:ro" -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec inbox-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

hdrs() { docker run --rm --network "$NET" "$CURL_IMG" -skI --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" | tr -d '\r' || true; }
body() { docker run --rm --network "$NET" "$CURL_IMG" -sk --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }
code() { docker run --rm --network "$NET" "$CURL_IMG" -sk -o /dev/null -w '%{http_code}' --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }

# --- the .invalid defaults (edge.yml) render a valid config ---
start_edge tunnel -e INBOX_DEMO_DOMAIN=inbox-demo.invalid -e INBOX_STAGING_DOMAIN=inbox-staging.invalid
docker exec inbox-edge nginx -t >/dev/null 2>&1 && pass "defaults: nginx -t" || fail "defaults: nginx -t" "non-zero"

# --- tunnel mode ---
start_edge tunnel -e INBOX_DEMO_DOMAIN=inbox-demo.test -e INBOX_STAGING_DOMAIN=inbox-staging.test
docker exec inbox-edge nginx -t >/dev/null 2>&1 && pass "tunnel: nginx -t" || fail "tunnel: nginx -t" "non-zero"
conf=$(docker exec inbox-edge nginx -T 2>/dev/null | tr -s ' ')
[[ "$conf" == *"server_name inbox-demo.test;"* && "$conf" == *"server_name inbox-staging.test;"* ]] \
  && pass "nginx -T includes both inbox blocks" || fail "nginx -T includes both inbox blocks" "missing"

b=$(body http inbox-demo.test /)
[ "$b" = demo-inbox-ok ] && pass "tunnel: demo inbox proxies to demo-mailpit:8025" || fail "tunnel: demo inbox" "$b"

h=$(hdrs http inbox-demo.test /)
grep -qi '^x-robots-tag: noindex' <<<"$h" && pass "tunnel: demo inbox sends X-Robots-Tag noindex" || fail "tunnel: demo X-Robots-Tag" "$h"

b=$(body http inbox-demo.test /robots.txt)
grep -q 'Disallow: /' <<<"$b" && pass "tunnel: demo inbox robots.txt disallows all" || fail "tunnel: demo robots.txt" "$b"

b=$(body http inbox-staging.test /)
[ "$b" = staging-inbox-ok ] && pass "tunnel: staging inbox proxies (Cloudflare Access is the outer login)" || fail "tunnel: staging inbox" "$b"

c=$(code http other.test /)
[ "$c" = 000 ] && pass "tunnel: unknown host dropped" || fail "tunnel: unknown host" "$c"

# --- direct mode: staging inbox needs the basic-auth login before any Mailpit byte ---
start_edge direct -e INBOX_DEMO_DOMAIN=inbox-demo.test -e INBOX_STAGING_DOMAIN=inbox-staging.test
docker exec inbox-edge nginx -t >/dev/null 2>&1 && pass "direct: nginx -t" || fail "direct: nginx -t" "non-zero"

c=$(code https inbox-staging.test /)
[ "$c" = 401 ] && pass "direct: staging inbox answers 401 without credentials" || fail "direct: staging inbox" "$c"

b=$(body https inbox-demo.test /)
[ "$b" = demo-inbox-ok ] && pass "direct: demo inbox is public" || fail "direct: demo inbox" "$b"

c=$(code https other.test /)
[ "$c" = 000 ] && pass "direct: unknown host dropped (handshake rejected)" || fail "direct: unknown host" "$c"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
