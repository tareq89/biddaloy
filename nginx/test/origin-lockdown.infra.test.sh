#!/usr/bin/env bash
# [75.5] Behaviour test for the origin lock-down in nginx/templates/default.conf.template:
#   - unknown Host (port 80) / unknown or missing SNI (port 443) -> nothing
#   - TRUSTED_PROXY_CIDRS set: a public, untrusted peer gets 444 everywhere
#     except /api/health and the ACME challenge path
#   - /healthz answers only to loopback
#   - TRUSTED_PROXY_CIDRS empty: named host answers every peer (today)
#   - nginx -t passes in both modes
# curl exit 52 = empty reply (nginx 444); 35 = TLS handshake rejected.
# The test network is the public documentation range 198.51.100.0/24 on
# purpose: its peers look like real public clients, not a private network. Needs docker only. Run: bash nginx/test/origin-lockdown.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=lockdown-test
VOL=lockdown-test-certs
NGINX_IMG=nginx:1.27-alpine
CURL_IMG=curlimages/curl
EDGE_IP=198.51.100.10
TRUSTED_IP=198.51.100.50
OTHER_IP=198.51.100.60
FAILS=0

cleanup() {
  docker rm -f lockdown-upstream lockdown-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 198.51.100.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "app-ok"; } }'
docker run -d --name lockdown-upstream --network "$NET" --network-alias app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

docker run --rm -e APP_DOMAIN=example.test -v "$VOL:/etc/letsencrypt" \
  -v "$PWD/nginx/generate-dummy-cert.sh:/scripts/generate-dummy-cert.sh:ro" \
  --entrypoint sh certbot/certbot /scripts/generate-dummy-cert.sh >/dev/null

run_edge() { # <cidrs>
  docker rm -f lockdown-edge >/dev/null 2>&1 || true
  docker run -d --name lockdown-edge --network "$NET" --ip "$EDGE_IP" \
    -e APP_DOMAIN=example.test -e "TRUSTED_PROXY_CIDRS=$1" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
    -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  # readiness: wait (max ~20 s) for 443 to listen, or for the container to exit
  for _ in $(seq 20); do
    [ "$(docker inspect -f '{{.State.Running}}' lockdown-edge)" = true ] || break
    docker exec lockdown-edge nc -z 127.0.0.1 443 >/dev/null 2>&1 && break
    sleep 1
  done
}

# curl_as <client-ip> <curl args...> -> prints "<http_code> <curl_exit>"
curl_as() {
  local ip="$1" rc code
  shift
  set +e
  code=$(docker run --rm --network "$NET" --ip "$ip" "$CURL_IMG" -s -m 5 --http1.1 \
    -o /dev/null -w '%{http_code}' "$@")
  rc=$?
  set -e
  echo "$code $rc"
}

# expect <label> <want "code rc"> <got "code rc">
expect() { [ "$3" = "$2" ] && pass "$1" || fail "$1" "$3 (want $2)"; }
https() { echo --resolve "example.test:443:$EDGE_IP" -k "https://example.test$1"; }

nginx_t() { # <cidrs>
  docker run --rm --network "$NET" -e APP_DOMAIN=example.test -e "TRUSTED_PROXY_CIDRS=$1" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/trusted-proxies.sh:/docker-entrypoint.d/15-trusted-proxies.sh:ro" \
    -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" sh -c \
    '/docker-entrypoint.sh true >/dev/null 2>&1; nginx -t' >/dev/null 2>&1
}
nginx_t "$TRUSTED_IP/32" && pass "nginx -t with a CIDR list" || fail "nginx -t with a CIDR list" "non-zero"
nginx_t "" && pass "nginx -t with empty list" || fail "nginx -t with empty list" "non-zero"

# --- list set: only TRUSTED_IP is Cloudflare ---
run_edge "$TRUSTED_IP/32"
expect "unknown Host on 80 -> 444" "000 52" "$(curl_as "$TRUSTED_IP" -H 'Host: evil.test' "http://$EDGE_IP/")"
expect "unknown SNI on 443 -> handshake rejected" "000 35" \
  "$(curl_as "$TRUSTED_IP" --resolve "evil.test:443:$EDGE_IP" -k https://evil.test/)"
expect "no SNI (bare IP) on 443 -> handshake rejected" "000 35" "$(curl_as "$TRUSTED_IP" -k "https://$EDGE_IP/")"
# shellcheck disable=SC2046
expect "trusted peer -> site 200" "200 0" "$(curl_as "$TRUSTED_IP" $(https /))"
for p in / /assets/x.js /api/v1/anything; do
  # shellcheck disable=SC2046
  expect "untrusted peer $p -> 444" "000 52" "$(curl_as "$OTHER_IP" $(https "$p"))"
done
# shellcheck disable=SC2046
expect "untrusted peer /api/health -> 200" "200 0" "$(curl_as "$OTHER_IP" $(https /api/health))"
# shellcheck disable=SC2046
expect "untrusted peer /api/health/ready -> 404 (unchanged)" "404 0" "$(curl_as "$OTHER_IP" $(https /api/health/ready))"
expect "untrusted peer ACME path on 80 -> 404 not 444" "404 0" \
  "$(curl_as "$OTHER_IP" -H 'Host: example.test' "http://$EDGE_IP/.well-known/acme-challenge/x")"
expect "untrusted peer / on 80 -> 444" "000 52" "$(curl_as "$OTHER_IP" -H 'Host: example.test' "http://$EDGE_IP/")"
[ "$(docker exec lockdown-edge wget -qO- http://127.0.0.1/healthz)" = "ok" ] \
  && pass "/healthz from loopback -> ok" || fail "/healthz from loopback" "not ok"
expect "/healthz from a public peer -> 444" "000 52" "$(curl_as "$OTHER_IP" -H 'Host: anything' "http://$EDGE_IP/healthz")"

# --- empty list: today's behaviour, any peer reaches the named host ---
run_edge ""
# shellcheck disable=SC2046
expect "empty list: any peer -> site 200" "200 0" "$(curl_as "$OTHER_IP" $(https /))"
expect "empty list: unknown Host still 444" "000 52" "$(curl_as "$OTHER_IP" -H 'Host: evil.test' "http://$EDGE_IP/")"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
