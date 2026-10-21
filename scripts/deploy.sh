#!/usr/bin/env bash
# Deploy from the laptop: checks the sha locally, then runs biddaloy-deploy on the VM.
#
#   BIDDALOY_HOST=203.0.113.10 scripts/deploy.sh staging <sha> [--hotfix "reason"] [--skip-backup]
#
# Same VM-side command as the GitHub "Deploy" workflow (Epic 79.0, D21).
set -euo pipefail

: "${BIDDALOY_HOST:?set BIDDALOY_HOST to the VM address}"
[ $# -ge 2 ] || { echo "usage: scripts/deploy.sh <prod|staging|demo|edge|ops|all> <sha> [--hotfix \"reason\"] [--skip-backup]" >&2; exit 2; }

stack="$1"
full=$(git rev-parse --verify --quiet "$2^{commit}") || { echo "unknown commit: $2 (fetch, or check the sha)" >&2; exit 2; }
if [ -z "$(git branch -r --contains "$full")" ]; then
  echo "$full is not on origin: push it first, the VM pulls from GitHub" >&2
  exit 2
fi
shift 2

# ssh joins its arguments and the remote shell splits them again, so quote each one.
cmd="biddaloy-deploy $(printf '%q ' "$stack" "$full" "$@")"
rc=0
ssh -o ServerAliveInterval=30 -- "deploy@$BIDDALOY_HOST" "$cmd" || rc=$?

echo
echo "exit $rc. Rerun with:"
echo "  BIDDALOY_HOST=$BIDDALOY_HOST scripts/deploy.sh $(printf '%q ' "$stack" "$full" "$@")"
exit "$rc"
