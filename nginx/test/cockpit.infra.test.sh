#!/usr/bin/env bash
# [98.2.05] Cockpit host: only the cockpit/platform API paths and the SPA are served; any other API
# path is a 404 there. The app host answers 404 for the cockpit/platform paths. The `.invalid`
# default renders a valid config; an unknown host is dropped. Needs docker only.
#   bash nginx/test/cockpit.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=cockpit-test
VOL=cockpit-test-le
AUTH=cockpit-test-auth
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.98.10
FAILS=0

cleanup() {
  docker rm -f cockpit-app-stub cockpit-app2-stub cockpit-edge >/dev/null 2>&1 || true
  docker volume rm "$VOL" "$AUTH" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.98.0/24 "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
docker volume create "$AUTH" >/dev/null

stub() { # <name> <alias>
  docker run -d --name "$1" --network "$NET" --network-alias "$2" --entrypoint sh "$NGINX_IMG" \
    -c "echo 'server { listen 3000; location / { default_type text/plain; return 200 \"app-ok\"; } }' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null
}
stub cockpit-app-stub prod-app
stub cockpit-app2-stub prod-app2

docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1
docker run --rm -v "$AUTH:/auth" --entrypoint sh alpine/openssl -c 'echo "u:$(openssl passwd -apr1 p)" > /auth/htpasswd' >/dev/null

start_edge() { # <mode> [extra docker env args...]
  local mode="$1"; shift
  docker rm -f cockpit-edge >/dev/null 2>&1 || true
  docker run -d --name cockpit-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$mode" \
    -e EDGE_TRUSTED_CIDR=172.30.98.0/24 -e APP_DOMAIN=example.test -e LANDING_DOMAIN=landing.test -e OPS_UPSTREAM_HOST= "$@" \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
    -v "$AUTH:/etc/nginx/auth:ro" -v "$VOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec cockpit-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

body() { docker run --rm --network "$NET" "$CURL_IMG" -sk --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }
code() { docker run --rm --network "$NET" "$CURL_IMG" -sk -o /dev/null -w '%{http_code}' --resolve "$2:80:$EDGE_IP" --resolve "$2:443:$EDGE_IP" "$1://$2$3" || true; }

start_edge tunnel -e COCKPIT_DOMAIN=cockpit.invalid
docker exec cockpit-edge nginx -t >/dev/null 2>&1 && pass "defaults: nginx -t" || fail "defaults: nginx -t" "non-zero"

check() { # <scheme> <label>
  local s="$1" m="$2" c b
  b=$(body "$s" cockpit.test /); [ "$b" = app-ok ] && pass "$m: cockpit host serves the SPA" || fail "$m: cockpit /" "$b"
  b=$(body "$s" cockpit.test /api/v1/platform/alerts); [ "$b" = app-ok ] && pass "$m: cockpit host proxies /api/v1/platform/" || fail "$m: platform" "$b"
  b=$(body "$s" cockpit.test /api/v1/auth/cockpit/login); [ "$b" = app-ok ] && pass "$m: cockpit host proxies /api/v1/auth/cockpit/" || fail "$m: cockpit login" "$b"
  c=$(code "$s" cockpit.test /api/v1/students); [ "$c" = 404 ] && pass "$m: cockpit host 404s other API paths" || fail "$m: students" "$c"
  c=$(code "$s" example.test /api/v1/platform/alerts); [ "$c" = 404 ] && pass "$m: app host 404s /api/v1/platform/" || fail "$m: app platform" "$c"
  c=$(code "$s" example.test /api/v1/auth/cockpit/login); [ "$c" = 404 ] && pass "$m: app host 404s /api/v1/auth/cockpit/" || fail "$m: app cockpit login" "$c"
  b=$(body "$s" example.test /api/v1/students); [ "$b" = app-ok ] && pass "$m: app host still proxies other API paths" || fail "$m: app students" "$b"
  c=$(code "$s" other.test /); [ "$c" = 000 ] && pass "$m: unknown host dropped" || fail "$m: unknown host" "$c"
}

start_edge tunnel -e COCKPIT_DOMAIN=cockpit.test
docker exec cockpit-edge nginx -t >/dev/null 2>&1 && pass "tunnel: nginx -t" || fail "tunnel: nginx -t" "non-zero"
check http tunnel

start_edge direct -e COCKPIT_DOMAIN=cockpit.test
docker exec cockpit-edge nginx -t >/dev/null 2>&1 && pass "direct: nginx -t" || fail "direct: nginx -t" "non-zero"
check https direct

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
