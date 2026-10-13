#!/usr/bin/env bash
# [75.4] Behaviour test for nginx/trusted-proxies.sh: runs the real edge nginx
# (same image, templates and mounts as docker-compose's `nginx` service) in
# front of a fake upstream that echoes X-Real-IP / X-Forwarded-For, and checks:
#   1. trusted peer + CF-Connecting-IP  -> upstream sees the header value
#   2. untrusted peer + CF-Connecting-IP -> upstream sees the peer (no spoofing)
#   3. empty TRUSTED_PROXY_CIDRS         -> header ignored (today's behaviour)
#   4. invalid entry                     -> container exits non-zero, names it
#   5. `nginx -t` passes in both modes
# Needs docker only (no app image, no database). Run by hand or by the CI
# `infra` job:  bash nginx/test/real-ip.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=realip-test
VOL=realip-test-certs
NGINX_IMG=nginx:1.27-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.99.10
TRUSTED_IP=172.30.99.50
OTHER_IP=172.30.99.60
FAILS=0

cleanup() {
  docker rm -f realip-upstream realip-edge realip-bad >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.99.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# Fake upstream, resolvable as `app` (what the nginx template proxies to).
UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "xri=$http_x_real_ip xff=$http_x_forwarded_for"; } }'
docker run -d --name realip-upstream --network "$NET" --network-alias app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

# Dummy cert, generated exactly like the compose `cert-bootstrap` service.
docker run --rm -e APP_DOMAIN=example.test -v "$VOL:/etc/letsencrypt" \
  -v "$PWD/nginx/generate-dummy-cert.sh:/scripts/generate-dummy-cert.sh:ro" \
  --entrypoint sh certbot/certbot /scripts/generate-dummy-cert.sh >/dev/null

# run_edge <name> <cidrs> [ip] — same mounts/env as the compose `nginx` service.
run_edge() {
  local name="$1" cidrs="$2" ip="${3:-}"
  local ipflag=()
  [ -n "$ip" ] && ipflag=(--ip "$ip")
  docker run -d --name "$name" --network "$NET" ${ipflag[@]+"${ipflag[@]}"} \
    -e APP_DOMAIN=example.test -e "TRUSTED_PROXY_CIDRS=$cidrs" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
    -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  # readiness: wait (max ~20 s) for 443 to listen, or for the container to exit
  for _ in $(seq 20); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
    docker exec "$name" nc -z 127.0.0.1 443 >/dev/null 2>&1 && break
    sleep 1
  done
}

# get_as <client-ip> — request through the edge, spoofing CF-Connecting-IP.
get_as() {
  docker run --rm --network "$NET" --ip "$1" "$CURL_IMG" -sk \
    --resolve "example.test:443:$EDGE_IP" -H 'CF-Connecting-IP: 203.0.113.9' \
    https://example.test/api/x
}

nginx_t() { # <cidrs>
  docker run --rm --network "$NET" -e APP_DOMAIN=example.test -e "TRUSTED_PROXY_CIDRS=$1" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
    -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" sh -c \
    '/docker-entrypoint.sh true >/dev/null 2>&1; nginx -t' 2>&1
}

# 5. config syntax, both modes
nginx_t '173.245.48.0/20 2400:cb00::/32' >/dev/null && pass "nginx -t with a CIDR list" || fail "nginx -t with a CIDR list" "non-zero"
nginx_t '' >/dev/null && pass "nginx -t with empty list" || fail "nginx -t with empty list" "non-zero"

# 1 + 2. trusted list = only TRUSTED_IP
run_edge realip-edge "$TRUSTED_IP/32" "$EDGE_IP"
body=$(get_as "$TRUSTED_IP")
[[ "$body" == *"xri=203.0.113.9"* && "$body" == *"xff=203.0.113.9"* ]] \
  && pass "trusted peer: header value reaches upstream" || fail "trusted peer" "$body"
body=$(get_as "$OTHER_IP")
[[ "$body" == *"xri=$OTHER_IP"* && "$body" != *"203.0.113.9"* ]] \
  && pass "untrusted peer: spoofed header ignored" || fail "untrusted peer" "$body"

# 3. empty list = today's behaviour
docker rm -f realip-edge >/dev/null
run_edge realip-edge "" "$EDGE_IP"
body=$(get_as "$TRUSTED_IP")
[[ "$body" == *"xri=$TRUSTED_IP"* && "$body" != *"203.0.113.9"* ]] \
  && pass "empty list: header ignored" || fail "empty list" "$body"

# 4. invalid entry stops the container and is named in its log
run_edge realip-bad "not-a-cidr"
code=$(docker inspect -f '{{.State.ExitCode}}' realip-bad)
logs=$(docker logs realip-bad 2>&1)
[[ "$code" != 0 && "$logs" == *"invalid entry 'not-a-cidr'"* ]] \
  && pass "invalid entry: exits non-zero, names the entry" || fail "invalid entry" "exit=$code $logs"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
