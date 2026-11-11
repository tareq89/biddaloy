#!/usr/bin/env bash
# [101.3.01] Runs every *.infra.test.sh, 4 at a time, and lists ALL failures (not just the first).
# ci.yml's "infra" job and scripts/ci-local.sh both call this, so they cannot drift.
#
# Two pairs of scripts create a docker network on the SAME subnet, so they cannot overlap:
#   inbox.infra.test.sh    + real-ip.infra.test.sh  (172.30.99.0/24)
#   hardening.infra.test.sh + site.infra.test.sh    (172.30.97.0/24)
# The second of each pair runs alone, after the parallel batch.
set -uo pipefail

serial_re='/(real-ip|site)\.infra\.test\.sh$'
logdir="$(mktemp -d)"
failed="$logdir/failed.txt"
: > "$failed"

run_one() { # run_one <script> <logdir>
  log="$2/$(echo "$1" | tr '/' '_').log"
  bash "$1" > "$log" 2>&1 || echo "$1" >> "$2/failed.txt"
}
export -f run_one

all="$(git ls-files '*.infra.test.sh')" || { echo "::error::git ls-files failed"; exit 1; }
[ -n "$all" ] || { echo "::error::no *.infra.test.sh found"; exit 1; }
dispatch_rc=0
# shellcheck disable=SC2016  # $1/$2 belong to the inner bash, not this shell
printf '%s\n' "$all" | grep -Ev "$serial_re" | xargs -P 4 -I{} bash -c 'run_one "$1" "$2"' _ {} "$logdir" || dispatch_rc=$?
printf '%s\n' "$all" | grep -E "$serial_re" | while read -r t; do run_one "$t" "$logdir"; done

for t in $all; do
  echo "::group::$t"
  cat "$logdir/$(echo "$t" | tr '/' '_').log" || true
  echo "::endgroup::"
done

[ "$dispatch_rc" = 0 ] || { echo "::error::parallel dispatcher exited $dispatch_rc"; exit 1; }
[ ! -s "$failed" ] || { echo "::error::failed: $(tr '\n' ' ' < "$failed")"; exit 1; }
echo "all infra tests passed"
