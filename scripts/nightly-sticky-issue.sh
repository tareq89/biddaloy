#!/usr/bin/env bash
#
# [#759] Shared "file/update/close one sticky issue" step for the nightly
# workflows (nightly-e2e.yml, nightly-quality.yml, nightly-frontend-flakes.yml).
# Before this script each nightly workflow either duplicated this logic
# (nightly-frontend-flakes.yml) or had no failure-visibility step at all
# (nightly-e2e.yml, nightly-quality.yml) — a red nightly run just vanished
# until someone happened to check the Actions tab.
#
# Usage:
#   scripts/nightly-sticky-issue.sh <label> <title> <body-file> <status>
#
#   <label>      GitHub label identifying this workflow's sticky issue
#                (e.g. "nightly-e2e-red", "nightly-quality-red", "flake-hunt").
#   <title>      Issue title used only when creating a new issue.
#   <body-file>  Path to a markdown file with the issue body. Ignored when
#                <status> is "success" (nothing to write, we just close).
#   <status>     "failure" -> create-or-edit the label's open sticky issue.
#                "success" -> close the label's open sticky issue, if any
#                             (no-op if none is open).
#
# Every issue this script touches also carries the shared `nightly-red`
# label (in addition to <label>), so "which nightlies are red right now"
# is one label filter across all three workflows:
#   gh issue list --label nightly-red --state open
#
# Env:
#   GH_TOKEN            required by `gh`.
#   GITHUB_REPOSITORY   "owner/repo", passed to every `gh ... --repo`.
#   GITHUB_RUN_ID        optional; if set, the close comment links the green
#                        run (https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID).
#   DRY_RUN=1           print the `gh` commands that would run instead of
#                        running them. For local testing without spamming
#                        real GitHub issues.
#
# This script must NEVER exit non-zero — a broken reporting step must not
# fail the nightly workflow it is reporting on. Every fallible step below
# is wrapped so a `gh` failure (rate limit, transient network blip, bad
# token) degrades to a loud warning instead of a red workflow run.
set -uo pipefail

label="${1:-}"
title="${2:-}"
body_file="${3:-}"
status="${4:-}"

run_gh() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "[DRY_RUN] gh $*"
  else
    gh "$@"
  fi
}

fail_soft() {
  echo "::warning title=nightly-sticky-issue::$*"
  exit 0
}

if [ -z "$label" ] || [ -z "$title" ] || [ -z "$status" ]; then
  fail_soft "usage: nightly-sticky-issue.sh <label> <title> <body-file> <status>; got label='$label' title='$title' status='$status'"
fi

if [ "$status" != "failure" ] && [ "$status" != "success" ]; then
  fail_soft "unknown status '$status', expected 'failure' or 'success'"
fi

if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  fail_soft "GITHUB_REPOSITORY is unset"
fi

# Auto-create both labels if missing. `--force` makes this a no-op when a
# label already exists, so it never fails a nightly run over a duplicate.
# `nightly-red` is the shared label every sticky issue also carries, so all
# currently-red nightlies can be queried with one label filter; <label> is
# this workflow's own label, applied alongside it.
run_gh label create nightly-red --repo "$GITHUB_REPOSITORY" \
  --color B60205 \
  --description "A nightly workflow is currently red" \
  --force || fail_soft "gh label create failed for 'nightly-red'"

run_gh label create "$label" --repo "$GITHUB_REPOSITORY" \
  --color B60205 \
  --description "Nightly workflow went red" \
  --force || fail_soft "gh label create failed for '$label'"

# `// empty` is load-bearing: on an empty list `.[0].number` is JSON
# `null`, and with `-r` that prints the literal string "null" — non-empty,
# so `-z` below would be false and the script would try `gh issue edit
# null` / `gh issue close null`.
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[DRY_RUN] gh issue list --repo $GITHUB_REPOSITORY --label $label --state open --json number --jq '.[0].number // empty'"
  issue_number=""
else
  issue_number="$(gh issue list --repo "$GITHUB_REPOSITORY" --label "$label" --state open --json number --jq '.[0].number // empty')" \
    || fail_soft "gh issue list failed for label '$label'"
fi

if [ "$status" = "success" ]; then
  if [ -n "$issue_number" ]; then
    if [ -n "${GITHUB_RUN_ID:-}" ]; then
      run_url="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
      close_comment="Green on ${run_url} — closing."
    else
      close_comment="Green again — closing."
    fi
    run_gh issue close "$issue_number" --repo "$GITHUB_REPOSITORY" \
      --comment "$close_comment" \
      || fail_soft "gh issue close failed for #$issue_number"
  else
    echo "No open '$label' sticky issue to close."
  fi
  exit 0
fi

# status = failure
if [ -z "$body_file" ] || [ ! -f "$body_file" ]; then
  fail_soft "body file '$body_file' missing or not found"
fi

if [ -n "$issue_number" ]; then
  run_gh issue edit "$issue_number" --repo "$GITHUB_REPOSITORY" --body-file "$body_file" \
    || fail_soft "gh issue edit failed for #$issue_number"
else
  run_gh issue create --repo "$GITHUB_REPOSITORY" \
    --title "$title" \
    --label "$label" \
    --label nightly-red \
    --body-file "$body_file" \
    || fail_soft "gh issue create failed for label '$label'"
fi
