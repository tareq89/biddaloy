#!/usr/bin/env bash
# Staging database control from the laptop: runs biddaloy-staging on the VM.
#
#   BIDDALOY_HOST=203.0.113.10 scripts/staging.sh status
#   BIDDALOY_HOST=203.0.113.10 scripts/staging.sh load            # shows the backup list, asks for a number
#   BIDDALOY_HOST=203.0.113.10 scripts/staging.sh load latest-daily --use --yes
#
# Same VM-side command as the GitHub "Staging" workflow (Epic 88, D7, D15).
set -euo pipefail

usage() {
  echo "usage: scripts/staging.sh <status|backups|load|use|clean-dev> [args]" >&2
  echo "  status | backups | load [key|latest-*|<number>] [--use] [--yes] | use dev|staging [--yes] | clean-dev [--yes]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
case "$1" in status|backups|load|use|clean-dev) ;; *) usage ;; esac
: "${BIDDALOY_HOST:?set BIDDALOY_HOST to the VM address}"
# A load backup is a list number or a key; a key follows the VM's rule (no "..", no "//").
if [ "$1" = load ]; then
  for a in "${@:2}"; do
    case "$a" in --*) continue ;; esac
    if ! [[ $a =~ ^[0-9]+$ ]] && { ! [[ $a =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$ ]] || [[ $a == *..* || $a == *//* ]]; }; then
      echo "not a backup: use a number from the list, latest-daily, latest-hourly or a key from backups" >&2
      exit 2
    fi
  done
fi

# ssh joins its arguments and the remote shell splits them again, so quote each one.
cmd="biddaloy-staging $(printf '%q ' "$@")"
rc=0
# -t: the pick list and the y/N prompts need a terminal.
ssh -t -o ServerAliveInterval=30 -- "deploy@$BIDDALOY_HOST" "$cmd" || rc=$?

echo
echo "exit $rc. Rerun with:"
echo "  BIDDALOY_HOST=$BIDDALOY_HOST scripts/staging.sh $(printf '%q ' "$@")"
exit "$rc"
