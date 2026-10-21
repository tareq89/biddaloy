#!/usr/bin/env bash
# [50 #2730] Landing server blocks: apex serves the static site with the reviewed headers,
# www and plain HTTP redirect, an unknown host or a non-Cloudflare peer is dropped.
# Same harness as hardening.infra.test.sh. Needs docker only.
#   bash nginx/test/landing.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=landing-test
VOL=landing-test-certs
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.98.10
LOCKED_IP=172.30.98.11
FAILS=0

cleanup() {
  docker rm -f landing-upstream landing-edge landing-locked >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.98.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# default.conf.template resolves `app` at start, so something must answer to that name.
UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "ok"; } }'
docker run -d --name landing-upstream --network "$NET" --network-alias app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

docker run --rm -e APP_DOMAIN=example.test -v "$VOL:/certs" \
  -v "$PWD/nginx/generate-dummy-cert.sh:/scripts/generate-dummy-cert.sh:ro" \
  --entrypoint sh certbot/certbot /scripts/generate-dummy-cert.sh >/dev/null

# $1 name, $2 ip, $3 TRUSTED_PROXY_CIDRS
start_edge() {
  docker run -d --name "$1" --network "$NET" --ip "$2" \
    -e APP_DOMAIN=example.test -e LANDING_DOMAIN=landing.test -e TRUSTED_PROXY_CIDRS="$3" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
    -v "$VOL:/etc/nginx/certs:ro" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec "$1" nc -z 127.0.0.1 443 >/dev/null 2>&1 && break
    sleep 1
  done
}

start_edge landing-edge "$EDGE_IP" ""
# Only 10.99.0.0/16 counts as Cloudflare here; the test client (172.30.x) is not.
start_edge landing-locked "$LOCKED_IP" "10.99.0.0/16"

# The site: root is <mount>/current, as in production (a symlink to releases/<sha>).
docker exec landing-edge sh -c '
  d=/usr/share/nginx/landing/releases/abc; mkdir -p "$d/bn" "$d/_astro"
  echo "<h1>bn</h1>" > "$d/bn/index.html"; echo "body{}" > "$d/_astro/x.css"; echo "u" > "$d/logo.png"
  ln -sfn releases/abc /usr/share/nginx/landing/current'

docker exec landing-edge nginx -t >/dev/null 2>&1 && pass "nginx -t" || fail "nginx -t" "non-zero"
conf=$(docker exec landing-edge nginx -T 2>/dev/null | tr -s ' ')
[[ "$conf" == *"server_name landing.test;"* && "$conf" == *"server_name www.landing.test;"* ]] \
  && pass "nginx -T includes the landing blocks" || fail "nginx -T includes the landing blocks" "missing"

# hdrs <ip> <host> <path>: response headers (CRs stripped). Empty + non-zero on a dropped request.
hdrs() { docker run --rm --network "$NET" "$CURL_IMG" -skI --resolve "$2:443:$1" "https://$2$3" | tr -d '\r'; }
code() { docker run --rm --network "$NET" "$CURL_IMG" -sk -o /dev/null -w '%{http_code}' --resolve "$2:443:$1" "https://$2$3" || true; }

c=$(code "$EDGE_IP" landing.test /bn/)
[ "$c" = 200 ] && pass "apex /bn/ is 200" || fail "apex /bn/" "$c"

h=$(hdrs "$EDGE_IP" landing.test /)
grep -qiE '^location: (https://landing.test)?/bn/$' <<<"$h" && grep -q ' 302' <<<"$h" && pass "apex / -> 302 /bn/" || fail "apex /" "$h"

h=$(hdrs "$EDGE_IP" www.landing.test /bn/?x=1)
grep -q ' 301' <<<"$h" && grep -qi '^location: https://landing.test/bn/?x=1' <<<"$h" \
  && pass "www -> 301 apex, path kept" || fail "www redirect" "$h"

h=$(docker run --rm --network "$NET" "$CURL_IMG" -sI -H 'Host: landing.test' "http://$EDGE_IP/bn/" | tr -d '\r')
grep -q ' 301' <<<"$h" && grep -qi '^location: https://landing.test/bn/' <<<"$h" \
  && pass "http -> 301 https apex" || fail "http redirect" "$h"

h=$(hdrs "$EDGE_IP" landing.test /_astro/x.css)
grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$h" \
  && pass "/_astro/ is immutable" || fail "/_astro/ cache" "$h"

h=$(hdrs "$EDGE_IP" landing.test /bn/)
grep -qi '^cache-control: no-cache' <<<"$h" && pass "html is no-cache" || fail "html cache" "$h"

h=$(hdrs "$EDGE_IP" landing.test /logo.png)
grep -qi '^cache-control: public, max-age=3600' <<<"$h" && pass "other assets cache for 1h" || fail "asset cache" "$h"

h=$(hdrs "$EDGE_IP" landing.test /bn/)
for want in "content-security-policy: default-src 'self'" "frame-ancestors 'none'" "base-uri 'none'" \
  "strict-transport-security: max-age=31536000" "referrer-policy: strict-origin-when-cross-origin" \
  "x-content-type-options: nosniff"; do
  grep -qi -- "$want" <<<"$h" && pass "header: $want" || fail "header: $want" "missing"
done

c=$(code "$EDGE_IP" landing.test /nope)
[ "$c" = 404 ] && pass "unknown path is 404" || fail "unknown path" "$c"

# Unknown SNI: the TLS handshake is rejected (curl exits non-zero, code 000).
c=$(code "$EDGE_IP" other.test /bn/)
[ "$c" = 000 ] && pass "unknown host dropped" || fail "unknown host" "$c"

# Rule 12: a peer outside TRUSTED_PROXY_CIDRS gets 444 (no response) on both landing hosts.
for host in landing.test www.landing.test; do
  c=$(code "$LOCKED_IP" "$host" /bn/)
  [ "$c" = 000 ] && pass "non-Cloudflare peer dropped ($host)" || fail "non-Cloudflare peer ($host)" "$c"
done

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
