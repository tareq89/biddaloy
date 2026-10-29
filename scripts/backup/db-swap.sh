#!/usr/bin/env bash
# Swaps a freshly built database into place by rename. Used by the demo rebuild (scripts/demo/reset.sh)
# and the staging refresh. One script, one copy (the demo image gets it through a build context).
#
#   db-swap.sh <live> <next>            live -> <live>_prev, <live>_prev -> <live>_prev_old, <next> -> live
#   db-swap.sh <live> <live>_prev       swap back: _prev becomes live, the old live becomes _prev
#   db-swap.sh --drop-prev-old <live>   drop <live>_prev_old (call it once the app is back)
#
# SAFETY: both names must match ^biddaloy_(staging|demo)[a-z0-9_]*$ and be in the same family, so
# this script can never rename or drop the production database `biddaloy`. Only one swap per live
# name runs at a time per container (flock on /tmp/db-swap-<live>.lock). /tmp is not shared between
# containers, so serialising swaps across containers is the caller's job (the host timer takes a
# flock on the host).
#
# Required env: DATABASE_URL (any URL on the server: host, credentials and query are reused; the
# role must be able to ALTER/DROP databases). Never echoes DATABASE_URL.
# Output: stdout `swap ok: <live> (was <next>), previous kept as <live>_prev`; on failure stderr
# `swap FAILED at <step>: <psql error>`, exit 1, after rolling back what it can. A bad argument or
# a refused name exits 2.
set -euo pipefail

# `biddaloy_staging_dev` (Epic 88) matches the staging family; it is never renamed, the guard just
# must not refuse it.
NAME_RE='^biddaloy_(staging|demo)[a-z0-9_]*$'
log() { printf '%s db-swap.sh: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
die() { echo "db-swap.sh: $*" >&2; exit 2; }
usage() { die "usage: db-swap.sh <live> <next> | db-swap.sh --drop-prev-old <live>"; }
assert_name() { [[ "$1" =~ $NAME_RE ]] || die "refusing to touch database '$1': name must match ${NAME_RE}"; }

DROP_ONLY=false
NEXT=""
case "${1:-}" in
  --drop-prev-old) [[ $# -eq 2 ]] || usage; DROP_ONLY=true; LIVE="$2" ;;
  -* | "") usage ;;
  *) [[ $# -eq 2 ]] || usage; LIVE="$1"; NEXT="$2" ;;
esac
assert_name "$LIVE"
case "$LIVE" in *_next | *_prev | *_prev_old) die "refusing '${LIVE}' as the live name: it ends in _next, _prev or _prev_old" ;; esac
PREV="${LIVE}_prev"
PREV_OLD="${LIVE}_prev_old"
if [[ "$DROP_ONLY" == false ]]; then
  assert_name "$NEXT"
  [[ "$NEXT" != "$LIVE" ]] || die "live and next are the same database"
  [[ "$NEXT" != "$PREV_OLD" ]] || die "refusing '${NEXT}' as next: it is ${LIVE}'s _prev_old"
  family() { [[ "${1#biddaloy_}" == demo* ]] && echo demo || echo staging; }
  [[ "$(family "$LIVE")" == "$(family "$NEXT")" ]] || die "live and next must both be demo or both be staging"
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
[[ "$DATABASE_URL" =~ ^(postgres(ql)?://[^/]+)/([^/?]+)(\?.*)?$ ]] || die "DATABASE_URL has no database name"
ADMIN_URL="${BASH_REMATCH[1]}/postgres${BASH_REMATCH[4]:-}"

# Every statement names a database that passed assert_name, so quoting it into SQL is safe.
psql_admin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -tAqc "$1"; }
db_exists() { [[ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]; }
rename_db() { psql_admin "ALTER DATABASE \"$1\" RENAME TO \"$2\"" >/dev/null; }
set_conn() { psql_admin "ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS $2" >/dev/null; }

exec 8>"/tmp/db-swap-${LIVE}.lock"
flock -n 8 || die "another swap of ${LIVE} is running; not starting"

STEP="start"
fail() { echo "swap FAILED at ${STEP}: ${1:-unknown error}" >&2; exit 1; }
# Runs one named step; on failure reports the step and psql's error.
step() {
  STEP="$1"; shift
  local out
  out="$("$@" 2>&1)" || fail "$out"
}

if [[ "$DROP_ONLY" == true ]]; then
  step drop-prev-old psql_admin "DROP DATABASE IF EXISTS \"${PREV_OLD}\" WITH (FORCE)"
  echo "dropped ${PREV_OLD}"
  exit 0
fi

LIVE_MOVED=false  # live -> _prev was attempted; set just BEFORE the rename, recover() asks the catalog
PREV_SHIFTED=false  # _prev -> _prev_old was attempted; set just BEFORE the rename
SWAP_BACK=false; [[ "$NEXT" == "$PREV" ]] && SWAP_BACK=true
TMP="${LIVE}_swap"  # swap-back only: where the old live waits while _prev becomes live

# Puts the databases in the safest state it can, and logs which.
recover() {
  if [[ "$SWAP_BACK" == true ]]; then
    # live -> TMP, _prev -> live, TMP -> _prev: finish whichever half was done.
    if db_exists "$TMP"; then
      if ! db_exists "$LIVE"; then rename_db "$TMP" "$LIVE" || { log "ROLLBACK FAILED: old live is ${TMP}: fix by hand"; return 1; }
      elif ! db_exists "$PREV"; then rename_db "$TMP" "$PREV" || { log "could not finish: old live is ${TMP}: fix by hand"; return 1; }
      fi
    fi
  else
    if [[ "$LIVE_MOVED" == true ]] && ! db_exists "$LIVE"; then
      if rename_db "$PREV" "$LIVE" 2>/dev/null || { db_exists "$LIVE" && ! db_exists "$PREV"; }; then
        log "rolled back: the previous database is ${LIVE} again"
      else
        log "ROLLBACK FAILED: the previous database is ${PREV}, there is no ${LIVE}, ${NEXT} is kept: fix by hand"
        return 1
      fi
    fi
    # Put the chain back: the old _prev went to _prev_old, and it must be _prev again.
    if [[ "$PREV_SHIFTED" == true ]] && db_exists "$LIVE" && ! db_exists "$PREV" && db_exists "$PREV_OLD"; then
      rename_db "$PREV_OLD" "$PREV" || { log "could not move ${PREV_OLD} back to ${PREV}: fix by hand"; return 1; }
    fi
  fi
  if db_exists "$LIVE"; then
    set_conn "$LIVE" true || { log "${LIVE} refuses connections: fix by hand"; return 1; }
  fi
  if db_exists "$PREV"; then set_conn "$PREV" true || true; fi
  if db_exists "$NEXT"; then set_conn "$NEXT" true || true; fi
}
on_exit() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then ( recover ) || log "recovery did not finish (see above)"; fi
  exit "$rc"
}
trap on_exit EXIT

STEP="check-next"
db_exists "$NEXT" || fail "${NEXT} does not exist"
if [[ "$SWAP_BACK" == true ]]; then
  db_exists "$LIVE" || fail "${LIVE} does not exist"
  ! db_exists "$TMP" || fail "${TMP} is left over from a failed swap-back: fix by hand"
  step next-block-connections set_conn "$NEXT" false
  step live-block-connections set_conn "$LIVE" false
  step live-terminate-sessions psql_admin \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIVE}' AND pid <> pg_backend_pid()"
  step live-to-tmp rename_db "$LIVE" "$TMP"
  step prev-to-live rename_db "$PREV" "$LIVE"
  step tmp-to-prev rename_db "$TMP" "$PREV"
  step reopen-live set_conn "$LIVE" true
  set_conn "$PREV" true || log "warning: could not re-open ${PREV}; it is fine but refuses connections"
  echo "swap ok: ${LIVE} (was ${NEXT}), previous kept as ${PREV}"
  exit 0
fi
if db_exists "$PREV"; then
  ! db_exists "$PREV_OLD" || fail "${PREV_OLD} still exists; run db-swap.sh --drop-prev-old ${LIVE} first"
  PREV_SHIFTED=true
  step prev-to-prev-old rename_db "$PREV" "$PREV_OLD"
fi
step next-block-connections set_conn "$NEXT" false
if db_exists "$LIVE"; then
  step live-block-connections set_conn "$LIVE" false
  step live-terminate-sessions psql_admin \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LIVE}' AND pid <> pg_backend_pid()"
  LIVE_MOVED=true
  step live-to-prev rename_db "$LIVE" "$PREV"
fi
STEP="next-to-live"
# psql can report an error for a rename that did commit (connection lost on the reply): the catalog decides.
if ! out="$(rename_db "$NEXT" "$LIVE" 2>&1)"; then
  if db_exists "$LIVE" && ! db_exists "$NEXT"; then
    log "psql reported an error, but ${NEXT} is now ${LIVE}"
  else
    fail "$out"
  fi
fi
step reopen-live set_conn "$LIVE" true
if [[ "$LIVE_MOVED" == true ]]; then
  # The swap is done; the previous database staying closed is only a warning.
  set_conn "$PREV" true || log "warning: could not re-open ${PREV}; re-open it by hand to use it as a rollback"
  echo "swap ok: ${LIVE} (was ${NEXT}), previous kept as ${PREV}"
else
  echo "swap ok: ${LIVE} (was ${NEXT}), there was no previous live database"
fi
