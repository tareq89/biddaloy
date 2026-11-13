#!/usr/bin/env bash
# [Epic 98 #4069] Both cockpit server blocks (prod host-cockpit, staging) send
# `Referrer-Policy: no-referrer` and hide the upstream's value, so the reset link's ?token=
# never leaves in a Referer header. Static check of the templates; needs only awk.
#   bash nginx/test/cockpit-referrer.infra.test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

FAILS=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }

# Print the server{} block that contains the given server_name line.
block() { # <file> <server_name token>
  awk -v tok="$2" '
    /^server[[:space:]]*\{/ { buf = ""; inblk = 1 }
    inblk { buf = buf $0 "\n" }
    inblk && /^\}/ { if (index(buf, tok)) printf "%s", buf; inblk = 0 }
  ' "$1"
}

check() { # <label> <file> <token>
  local b
  b=$(block "$2" "$3")
  [ -n "$b" ] || { fail "$1: server block for $3 not found"; return; }
  grep -q 'add_header Referrer-Policy "no-referrer" always;' <<<"$b" \
    && pass "$1: Referrer-Policy no-referrer" || fail "$1: Referrer-Policy no-referrer"
  grep -q 'proxy_hide_header Referrer-Policy;' <<<"$b" \
    && pass "$1: upstream Referrer-Policy hidden" || fail "$1: upstream Referrer-Policy hidden"
  # A location with its own add_header would drop the inherited one.
  ! awk '/^[[:space:]]+location/ { loc = 1 } loc && /add_header/ { found = 1 } END { exit !found }' <<<"$b" \
    && pass "$1: no location overrides add_header" || fail "$1: a location sets add_header"
}

check "prod cockpit" nginx/templates/host-cockpit.conf.template 'server_name ${COCKPIT_DOMAIN}'
check "staging cockpit" nginx/templates/staging.conf.template 'server_name ${COCKPIT_STAGING_DOMAIN}'

[ "$FAILS" -eq 0 ] || { echo "$FAILS failure(s)"; exit 1; }
