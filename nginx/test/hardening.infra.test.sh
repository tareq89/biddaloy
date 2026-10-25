#!/usr/bin/env bash
# [75.21] nginx hardening: explicit slow-client timeouts and no version in
# the `Server:` header. Same harness as real-ip.infra.test.sh. Needs docker only.
#   bash nginx/test/hardening.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=hardening-test
VOL=hardening-test-le
NGINX_IMG=nginx:1.31-alpine
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
docker run -d --name hardening-upstream --network "$NET" --network-alias prod-app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

# Direct mode serves TLS from where certbot would put the certificate.
docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1

docker run -d --name hardening-edge --network "$NET" --ip "$EDGE_IP" \
  -e EDGE_MODE=direct -e APP_DOMAIN=example.test -e OPS_UPSTREAM_HOST= \
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
  -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
  -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
  -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
for _ in $(seq 20); do
  docker exec hardening-edge nc -z 127.0.0.1 443 >/dev/null 2>&1 && break
  sleep 1
done

# nginx -t + effective config
docker exec hardening-edge nginx -t >/dev/null 2>&1 && pass "nginx -t" || fail "nginx -t" "non-zero"
# Squeeze runs of spaces: the template aligns values (`client_body_timeout   30s;`).
conf=$(docker exec hardening-edge nginx -T 2>/dev/null | tr -s ' ')
for d in 'client_header_timeout 10s' 'client_body_timeout 30s' 'send_timeout 30s' 'server_tokens off'; do
  [[ "$conf" == *"$d;"* ]] && pass "config has: $d" || fail "config has: $d" "missing"
done

# Server header carries no version
hdr=$(docker run --rm --network "$NET" "$CURL_IMG" -skI --resolve "example.test:443:$EDGE_IP" https://example.test/ | tr -d '\r' | grep -i '^server:' || true)
[[ "$hdr" =~ ^[Ss]erver:\ nginx$ ]] && pass "Server header has no version" || fail "Server header" "$hdr"

# Slow header: an unfinished request must be closed in ~10 s, not held for 20+.
# The client times itself: the pipeline as a whole always lasts as long as the
# writer's `sleep 20`, whenever nginx hangs up. Over 5 s also proves the TLS
# client really connected (a failed connect exits at once).
elapsed=$(docker run --rm --network "$NET" --entrypoint sh alpine/openssl -c \
  "s=\$(date +%s); { printf 'GET / HTTP/1.1\r\nHost: example.test\r\n'; sleep 20; } | { timeout 25 openssl s_client -quiet -connect $EDGE_IP:443 -servername example.test >/dev/null 2>&1; echo \$(( \$(date +%s) - s )); }" || true)
if [ -n "$elapsed" ] && [ "$elapsed" -ge 5 ] && [ "$elapsed" -le 15 ]; then
  pass "slow header closed in ${elapsed}s"
else
  fail "slow header" "${elapsed:-no result}s"
fi

# The demo host serves its own robots.txt (Disallow all) and never gets indexed.
conf=$(docker exec hardening-edge nginx -T 2>/dev/null | tr -s ' ')
[[ "$conf" == *'Disallow: /'* && "$conf" == *'X-Robots-Tag "noindex, nofollow"'* ]] \
  && pass "demo block: robots.txt Disallow and noindex" || fail "demo block: robots.txt / noindex" "missing"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
