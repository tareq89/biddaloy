#!/usr/bin/env bash
# [75.4, 79.0] Behaviour test for nginx/edge-mode.sh: runs the real edge nginx (same image,
# templates and mounts as deploy/edge.yml's `nginx` service) in front of a fake upstream
# that echoes X-Real-IP / X-Forwarded-For, and checks:
#   1. tunnel mode: a request from the edge subnet with CF-Connecting-IP is seen by the
#      upstream and written to the access log under that address
#   2. tunnel mode, no header: the peer address is used
#   3. direct mode: CF-Connecting-IP is ignored, the TCP peer is used (no spoofing)
#   4. `nginx -t` passes in both modes
# Needs docker only (no app image, no database). Run by hand or by the CI `infra` job:
#   bash nginx/test/real-ip.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=realip-test
VOL=realip-test-le
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.99.10
CLIENT_IP=172.30.99.50
OTHER_IP=172.30.99.60
FAILS=0

cleanup() {
  docker rm -f realip-upstream realip-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.99.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# Fake upstream, resolvable as `prod-app` (what default.conf.template proxies to).
UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "xri=$http_x_real_ip xff=$http_x_forwarded_for xfp=$http_x_forwarded_proto"; } }'
docker run -d --name realip-upstream --network "$NET" --network-alias prod-app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

# Self-signed cert where certbot would put it (direct mode reads /etc/letsencrypt/live/<APP_DOMAIN>).
docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1

EDGE_ARGS=(-e APP_DOMAIN=example.test -e STAGING_DOMAIN=staging.example.test -e DEMO_DOMAIN=demo.example.test
  -e LANDING_DOMAIN=landing.example.test -e KUMA_DOMAIN=kuma.example.test -e BESZEL_DOMAIN=beszel.example.test
  -e LOGS_DOMAIN=logs.example.test -e OPS_UPSTREAM_HOST=
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro"
  -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro"
  -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro"
  -v "$VOL:/etc/letsencrypt:ro")

# run_edge <tunnel|direct> [trusted-cidr] — same mounts/env as the compose `nginx` service.
run_edge() {
  docker rm -f realip-edge >/dev/null 2>&1 || true
  docker run -d --name realip-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$1" \
    -e "EDGE_TRUSTED_CIDR=${2-}" "${EDGE_ARGS[@]}" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec realip-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

nginx_t() { # <mode>
  docker run --rm --network "$NET" -e "EDGE_MODE=$1" "${EDGE_ARGS[@]}" "$NGINX_IMG" nginx -t >/dev/null 2>&1
}

# get_tunnel <header-args...> — plain HTTP through the edge, as cloudflared would.
get_tunnel() {
  docker run --rm --network "$NET" --ip "${FROM_IP:-$CLIENT_IP}" "$CURL_IMG" -s -H 'Host: example.test' "$@" "http://$EDGE_IP/api/x" || true
}
# get_direct <header-args...> — HTTPS through the edge.
get_direct() {
  docker run --rm --network "$NET" --ip "$CLIENT_IP" "$CURL_IMG" -sk --resolve "example.test:443:$EDGE_IP" "$@" https://example.test/api/x || true
}

# 4. config syntax, both modes
nginx_t tunnel && pass "nginx -t, tunnel" || fail "nginx -t, tunnel" "non-zero"
nginx_t direct && pass "nginx -t, direct" || fail "nginx -t, direct" "non-zero"

# 1 + 2. tunnel mode
run_edge tunnel
body=$(get_tunnel -H 'CF-Connecting-IP: 203.0.113.9')
[[ "$body" == *"xri=203.0.113.9"* && "$body" == *"xff=203.0.113.9"* ]] \
  && pass "tunnel: CF-Connecting-IP reaches upstream" || fail "tunnel: header" "$body"
sleep 1
docker logs realip-edge 2>&1 | grep -q '^203\.0\.113\.9 - \[' \
  && pass "tunnel: access log has the visitor address" || fail "tunnel: access log" "$(docker logs realip-edge 2>&1 | tail -3)"
body=$(get_tunnel)
[[ "$body" == *"xri=$CLIENT_IP"* ]] && pass "tunnel: no header, peer address used" || fail "tunnel: no header" "$body"

# 1b. the app is told https even though cloudflared speaks plain HTTP (SameOriginGuard needs it)
body=$(get_tunnel)
[[ "$body" == *"xfp=https"* ]] && pass "tunnel: X-Forwarded-Proto is https" || fail "tunnel: X-Forwarded-Proto" "$body"

# 1c. trust is limited to the configured subnet: a peer outside it cannot set the address
run_edge tunnel "$CLIENT_IP/32"
body=$(get_tunnel -H 'CF-Connecting-IP: 203.0.113.9')
[[ "$body" == *"xri=203.0.113.9"* ]] && pass "tunnel, pinned CIDR: trusted peer's header used" || fail "tunnel pinned: trusted" "$body"
body=$(FROM_IP=$OTHER_IP get_tunnel -H 'CF-Connecting-IP: 203.0.113.9')
[[ "$body" == *"xri=$OTHER_IP"* && "$body" != *"203.0.113.9"* ]] \
  && pass "tunnel, pinned CIDR: untrusted peer's header ignored" || fail "tunnel pinned: untrusted" "$body"

# 3. direct mode
run_edge direct
body=$(get_direct -H 'CF-Connecting-IP: 203.0.113.9')
[[ "$body" == *"xri=$CLIENT_IP"* && "$body" != *"203.0.113.9"* ]] \
  && pass "direct: spoofed header ignored" || fail "direct: header" "$body"
[[ "$body" == *"xfp=https"* ]] && pass "direct: X-Forwarded-Proto is https" || fail "direct: X-Forwarded-Proto" "$body"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
