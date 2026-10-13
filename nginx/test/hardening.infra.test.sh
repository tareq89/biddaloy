#!/usr/bin/env bash
# [75.21] nginx hardening: explicit slow-client timeouts and no version in
# the `Server:` header. Same harness as real-ip.infra.test.sh. Needs docker only.
#   bash nginx/test/hardening.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=hardening-test
VOL=hardening-test-certs
NGINX_IMG=nginx:1.27-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.97.10
FAILS=0

cleanup() {
  docker rm -f hardening-upstream hardening-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.97.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "ok"; } }'
docker run -d --name hardening-upstream --network "$NET" --network-alias app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

docker run --rm -e APP_DOMAIN=example.test -v "$VOL:/etc/letsencrypt" \
  -v "$PWD/nginx/generate-dummy-cert.sh:/scripts/generate-dummy-cert.sh:ro" \
  --entrypoint sh certbot/certbot /scripts/generate-dummy-cert.sh >/dev/null

docker run -d --name hardening-edge --network "$NET" --ip "$EDGE_IP" \
  -e APP_DOMAIN=example.test -e TRUSTED_PROXY_CIDRS= \
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
  -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
  -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
  -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
for _ in $(seq 20); do
  docker exec hardening-edge nc -z 127.0.0.1 443 >/dev/null 2>&1 && break
  sleep 1
done

# nginx -t + effective config
docker exec hardening-edge nginx -t >/dev/null 2>&1 && pass "nginx -t" || fail "nginx -t" "non-zero"
conf=$(docker exec hardening-edge nginx -T 2>/dev/null)
for d in 'client_header_timeout 10s' 'client_body_timeout 30s' 'send_timeout 30s' 'server_tokens off'; do
  [[ "$conf" == *"$d;"* ]] && pass "config has: $d" || fail "config has: $d" "missing"
done

# Server header carries no version
hdr=$(docker run --rm --network "$NET" "$CURL_IMG" -skI --resolve "example.test:443:$EDGE_IP" https://example.test/ | tr -d '\r' | grep -i '^server:' || true)
[[ "$hdr" =~ ^[Ss]erver:\ nginx$ ]] && pass "Server header has no version" || fail "Server header" "$hdr"

# Slow header: an unfinished request must be closed in ~10 s, not held for 20+.
start=$(date +%s)
docker run --rm --network "$NET" --entrypoint sh alpine/openssl -c \
  "(printf 'GET / HTTP/1.1\r\nHost: example.test\r\n'; sleep 20) | timeout 25 openssl s_client -quiet -connect $EDGE_IP:443 -servername example.test >/dev/null 2>&1" || true
elapsed=$(( $(date +%s) - start ))
[ "$elapsed" -le 15 ] && pass "slow header closed in ${elapsed}s" || fail "slow header" "${elapsed}s"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
