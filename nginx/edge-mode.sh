#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 15-edge-mode.sh, so nginx's stock
# entrypoint runs it before 20-envsubst-on-templates.sh (and before nginx).
#
# Reads EDGE_MODE and writes the parts of the config that differ between the two
# ways the origin can be reached (Epic 79.0, D8):
#
#   tunnel  cloudflared dials in over the `biddaloy-edge` network, plain HTTP on :80.
#           The visitor address comes from CF-Connecting-IP, but only from the trusted
#           subnet EDGE_TRUSTED_CIDR (required, pinned by the deploy); no TLS lines, no basic auth
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
CONF_DIR="$ROOT/conf.d"
CONF="$CONF_DIR/00-edge.conf"
SERVER="$ROOT/snippets/edge-server.conf"
DEFAULT="$ROOT/snippets/edge-default.conf"

# Docker's embedded DNS: upstreams with `resolve` re-look-up their names, so nginx boots
# when a container (staging, the second app, ops) is not up yet.
RESOLVER='resolver 127.0.0.11 valid=10s ipv6=off;
# Long exact host names in the site-host map (conf.d/01-site-host.conf, below) overflow the default
# 64-byte bucket and fail `nginx -t`. It must come before the FIRST map block, hence it lives here.
map_hash_bucket_size 128;'

if [ "$MODE" = tunnel ]; then
  # Required, never detected (Rule 11): cloudflared starts after nginx is healthy, so it cannot
  # be looked up here, and guessing an interface could trust the wrong network. A wrong subnet
  # gives every visitor cloudflared's address, so one abuser's login throttle locks out everyone.
  subnet="${EDGE_TRUSTED_CIDR:-}"
  [ -n "$subnet" ] || die "EDGE_TRUSTED_CIDR must be set in tunnel mode (the pinned biddaloy-edge subnet)"
  case "$subnet" in
  *[!0-9./]*) die "invalid EDGE_TRUSTED_CIDR '$subnet'" ;;
  esac
  printf '%s\n' "$subnet" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' ||
    die "invalid EDGE_TRUSTED_CIDR '$subnet'"
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

# School-site host gate (Epic 40, site.conf.template), written to conf.d/01-site-host.conf so the
# map exists before site.conf is parsed. `$site_host_ok` is 1 only for a host the :8081 listener
# may hand to the site container:
#   1. a fixed host (APP_DOMAIN, STAGING_DOMAIN, ... exact names)          -> 0 (Rule 12)
#   2. one label of 3-30 characters under ROOT_DOMAIN (SITE_SUBDOMAIN_RE)  -> 1
#   3. anything else under ROOT_DOMAIN (the apex, a.b.<root>, ...)         -> 0
#      (`sites.<root>` is one label: rule 2 gives it 1, the site container 404s it)
#   4. any other well-formed name with an alphabetic last label            -> 1  (a school's own
#      domain, e.g. www.school.edu.bd; the site container answers 404 unless it is an ACTIVE
#      custom domain). IP literals, empty and malformed hosts are 0.
# Rule 3 escapes the dots, so `rumsc.schoolsXtest` is NOT under the root (it is a plain name, rule 4).
# Unset ROOT_DOMAIN, or the compose default `root.invalid` (deploy/edge.yml), means an edge with no
# school sites: every host 0, no custom path. $host is already lower-cased and
# port-free. nginx tries map regexes in file order, exact names first.
# Example: ROOT_DOMAIN=schools.test -> rumsc.schools.test 1, www.school.edu.bd 1, app host 0, a.b.schools.test 0.
site_root=$(printf '%s' "${ROOT_DOMAIN:-}" | tr 'A-Z' 'a-z')
case "$site_root" in
  *[!a-z0-9.-]* | .* | *. | -*) die "ROOT_DOMAIN must be a host name (got '$site_root')" ;;
  *.invalid) site_root='' ;;
esac
{
  echo '# Written by edge-mode.sh from ROOT_DOMAIN and the fixed host names. Do not edit.'
  echo 'map $host $site_host_ok {'
  echo '    default 0;'
  if [ -n "$site_root" ]; then
    for v in APP_DOMAIN STAGING_DOMAIN DEMO_DOMAIN KUMA_DOMAIN BESZEL_DOMAIN LOGS_DOMAIN \
      INBOX_DEMO_DOMAIN INBOX_STAGING_DOMAIN COCKPIT_DOMAIN LANDING_DOMAIN; do
      eval "h=\${$v:-}"
      [ -n "$h" ] || continue
      h=$(printf '%s' "$h" | tr 'A-Z' 'a-z')
      case "$h" in
        *[!a-z0-9.-]* | .* | *. | -*) die "$v must be a host name (got '$h')" ;;
      esac
      printf '    "%s" 0;\n' "$h"
      if [ "$v" = LANDING_DOMAIN ]; then printf '    "www.%s" 0;\n' "$h"; fi
    done
    root_re=$(printf '%s' "$site_root" | sed 's/\./\\./g')
    printf '    "~^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\\.%s$" 1;\n' "$root_re"
    printf '    "~*(^|\\.)%s$" 0;\n' "$root_re"
    printf '%s\n' '    "~^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$" 1;'
  fi
  echo '}'
  # Which site container answers (Epic 40 #3711): a label ending -demo or -staging goes to that
  # environment's container, everything else (and every custom domain) to prod. Only a label
  # directly under the root matches, so a.b-demo.<root> stays prod. Same suffix rule as
  # labelEnvTag() in shared/src/types/site.ts. No root: default only, never an invalid regex.
  echo 'map $host $site_upstream_name {'
  echo '    default site_upstream;'
  if [ -n "$site_root" ]; then
    printf '    "~^[a-z0-9][a-z0-9-]*-demo\\.%s$" site_demo;\n' "$root_re"
    printf '    "~^[a-z0-9][a-z0-9-]*-staging\\.%s$" site_staging;\n' "$root_re"
  fi
  echo '}'
  # Same split for the app-host calls (/media/, /_api/): a -demo or -staging school lives in that
  # environment's database, so the by-host API must be that environment's app, never prod's.
  # The upstreams are the fixed-host ones (demo.conf.template, staging.conf.template).
  echo 'map $host $site_app_upstream_name {'
  echo '    default app_upstream;'
  if [ -n "$site_root" ]; then
    printf '    "~^[a-z0-9][a-z0-9-]*-demo\\.%s$" demo_upstream;\n' "$root_re"
    printf '    "~^[a-z0-9][a-z0-9-]*-staging\\.%s$" staging_upstream;\n' "$root_re"
  fi
  echo '}'
  # Demo and staging school sites are never indexed (staging holds a scrubbed copy of prod data).
  echo 'map $host $site_env_noindex {'
  echo '    default "";'
  if [ -n "$site_root" ]; then
    printf '    "~^[a-z0-9][a-z0-9-]*-(demo|staging)\\.%s$" noindex;\n' "$root_re"
  fi
  echo '}'
  # Staging school hosts (#3715). cloudflared's Access rule is one exact hostname per listed
  # school (it cannot match "*-staging.<root>", only a leading "*."), so nginx must agree with
  # that list and fail closed: a -staging host NOT in STAGING_SITE_HOSTS gets "unlisted" (444),
  # a listed one gets "listed" (site.conf.template then also insists on the clean spelling, as
  # cloudflared matches names case-sensitively). Exact names come first, so they beat the regex.
  # Example: STAGING_SITE_HOSTS="model-school-staging.schools.test" -> that host "listed",
  # any other x-staging.schools.test "unlisted", demo / prod hosts "" (untouched).
  echo 'map $host $site_staging_state {'
  echo '    default "";'
  if [ -n "$site_root" ]; then
    seen=" "
    # Two checks guard this list. Preflight (infra/ansible/tasks/preflight.yml) is the fast, early
    # catch at deploy time; this script, plus $site_host_ok in site.conf.template, is the one that
    # decides at start-up. They differ in three edge cases, all failing closed (no host is served
    # that should not be): "a.b-staging.<root>" passes here (the case "*" crosses dots) but not
    # preflight; an upper-case ROOT_DOMAIN is lower-cased here but used raw by preflight; a school
    # label over 30 characters passes both, then $site_host_ok answers 444.
    set -f # split on spaces only: "*-staging.<root>" must hit the case below, not match a file
    for h in ${STAGING_SITE_HOSTS:-}; do
      # No silent lower-casing: cloudflared uses each entry verbatim and matches case-sensitively,
      # so an upper-case entry would pass here yet never match its Access rule.
      case "$h" in
        *[!a-z0-9.-]* | .* | *. | -* | *..*) die "STAGING_SITE_HOSTS entry must be a lower-case host name (got '$h')" ;;
        [a-z0-9]*-staging."$site_root") ;;
        *) die "STAGING_SITE_HOSTS entry must be <school>-staging.$site_root (got '$h')" ;;
      esac
      # A duplicate would make nginx refuse to start ("conflicting parameter" in the map).
      case "$seen" in *" $h "*) die "STAGING_SITE_HOSTS lists '$h' twice" ;; esac
      seen="$seen$h "
      printf '    "%s" listed;\n' "$h"
    done
    set +f
    printf '    "~^[a-z0-9][a-z0-9-]*-staging\\.%s$" unlisted;\n' "$root_re"
  fi
  echo '}'
} >"$CONF_DIR/01-site-host.conf"

# Ops-less hosts (OPS_UPSTREAM_HOST empty): conf.d/ops.conf is removed by reload-loop.sh,
# which runs after the templates are rendered; this script runs before.
echo "edge-mode.sh: wrote $CONF (EDGE_MODE=$MODE)"
