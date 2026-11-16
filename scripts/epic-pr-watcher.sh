#!/usr/bin/env bash
#
# epic-pr-watcher.sh <epic-number> — one stateless tick that keeps an epic's
# stacked PRs moving: asks CodeRabbit, then fixes the lowest PR that has
# unresolved CodeRabbit threads or a merge conflict, then restacks the PRs above.
#
# Run it from launchd (see .claude/skills/watch-epic). All state is read back
# from GitHub, so a missed tick, a reboot or a crash loses nothing.
#
#   launchd (10 min) -> tick
#     1. coderabbit-review-queue.sh --once     (ask for the next review)
#     2. epic PRs, bottom-up (base chain of branches epic/<n>/*)
#     3. lowest PR with conflict OR unresolved CodeRabbit thread
#          -> claude -p "/pr-fix N --unattended"
#          -> git rebase --onto every PR above, push --force-with-lease
#     4. no epic PR open any more -> unload the launchd job, notify
#
# A PR that fails 3 times at the same head commit gets the `needs-human`
# label and a comment; it and every PR above it are left alone.
#
# Usage: scripts/epic-pr-watcher.sh <epic> [--dry-run]
# Env:   REPO (tareq89/biddaloy)  MAX_ATTEMPTS (3)  CLAUDE_BIN (claude)
#        CLAUDE_FLAGS ("--permission-mode bypassPermissions")  QUEUE (1 = ask CodeRabbit)

set -uo pipefail

EPIC="${1:-}"
[[ "$EPIC" =~ ^[0-9]+$ ]] || { echo "usage: $0 <epic-number> [--dry-run]" >&2; exit 2; }
DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1
REPO="${REPO:-tareq89/biddaloy}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
CLAUDE_FLAGS="${CLAUDE_FLAGS:---permission-mode bypassPermissions}"
QUEUE="${QUEUE:-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.biddaloy.epic-watch.$EPIC"
MARK='<!-- epic-watch-attempt'

log() { printf '%s  [epic %s] %s\n' "$(date '+%F %T')" "$EPIC" "$*"; }
notify() { osascript -e "display notification \"$1\" with title \"epic $EPIC watcher\"" >/dev/null 2>&1 || true; }

LOCK="${TMPDIR:-/tmp}/epic-watch.$EPIC.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  other="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then log "previous tick still running"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo "$$" >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# Open PRs on epic/<n>/*, ordered bottom-up by the base→head chain.
prs="$(gh pr list -R "$REPO" --state open --limit 100 \
  --json number,headRefName,baseRefName,headRefOid,mergeable,labels |
  jq -c --arg p "epic/$EPIC/" '
    map(select(.headRefName | startswith($p))) as $all
    | ($all | map(.headRefName)) as $heads
    | def chain($base): ($all | map(select(.baseRefName == $base)) | sort_by(.number))
                        | map(., (.headRefName | chain(.)[]));
      ($all | map(select(.baseRefName as $b | $heads | index($b) | not)) | sort_by(.number)) as $roots
    | [$roots[] | ., (.headRefName | chain(.))] | flatten')" || { log "gh pr list failed"; exit 0; }

if [ "$(jq length <<<"$prs")" = 0 ]; then
  log "no open PRs left — done"
  if [ "$DRY_RUN" = 0 ]; then
    notify "all PRs merged/closed, watcher stopped"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  fi
  exit 0
fi

# 1. keep CodeRabbit reviews flowing (own rate-limit pacing lives in that script)
if [ "$QUEUE" = 1 ] && [ "$DRY_RUN" = 0 ]; then
  REPO="$REPO" "$ROOT/scripts/coderabbit-review-queue.sh" --once || true
fi

unresolved() { # count of unresolved CodeRabbit threads on PR $1
  gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
    reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}' \
    -f o="${REPO%/*}" -f r="${REPO#*/}" -F n="$1" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
           | select(.isResolved == false and (.comments.nodes[0].author.login // "" | startswith("coderabbitai")))] | length'
}

# 2-3. lowest PR that needs work
target=""; reason=""
for i in $(seq 0 $(($(jq length <<<"$prs") - 1))); do
  pr="$(jq -c ".[$i]" <<<"$prs")"; n="$(jq -r .number <<<"$pr")"
  if jq -e '.labels | map(.name) | index("needs-human")' <<<"$pr" >/dev/null; then
    log "#$n is needs-human — leaving it and everything above it alone"; break
  fi
  threads="$(unresolved "$n")" || { log "could not read threads of #$n"; exit 0; }
  if [ "$(jq -r .mergeable <<<"$pr")" = CONFLICTING ]; then target="$i"; reason="merge conflict"; break; fi
  if [ "${threads:-0}" -gt 0 ]; then target="$i"; reason="$threads unresolved CodeRabbit thread(s)"; break; fi
done
[ -z "$target" ] && { log "nothing to fix"; exit 0; }

pr="$(jq -c ".[$target]" <<<"$prs")"
n="$(jq -r .number <<<"$pr")"; head="$(jq -r .headRefName <<<"$pr")"; sha="$(jq -r .headRefOid <<<"$pr")"

attempts="$(gh pr view "$n" -R "$REPO" --json comments \
  --jq "[.comments[].body | select(contains(\"$MARK sha=$sha\"))] | length")"
if [ "${attempts:-0}" -ge "$MAX_ATTEMPTS" ]; then
  log "#$n failed $attempts times at ${sha:0:9} — needs-human"
  if [ "$DRY_RUN" = 0 ]; then
    gh pr edit "$n" -R "$REPO" --add-label needs-human >/dev/null 2>&1 || true
    gh pr comment "$n" -R "$REPO" --body "epic-watch: gave up on this PR after $attempts unattended attempts at \`${sha:0:9}\` ($reason). Needs a human; remove the \`needs-human\` label to resume." >/dev/null
    notify "#$n needs a human ($reason)"
  fi
  exit 0
fi

log "fixing #$n ($reason), attempt $((attempts + 1))/$MAX_ATTEMPTS"
if [ "$DRY_RUN" = 1 ]; then log "DRY RUN: would run /pr-fix $n --unattended"; exit 0; fi

gh pr comment "$n" -R "$REPO" --body "$MARK sha=$sha -->
epic-watch: unattended fix started ($reason)." >/dev/null

# Remember every branch tip above this PR so we can restack with --onto afterwards.
above="$(jq -c "[.[$((target + 1)):][] | {number, headRefName, baseRefName, headRefOid}]" <<<"$prs")"
old_tip="$sha"

cd "$ROOT" || exit 1
# shellcheck disable=SC2086
caffeinate -i "$CLAUDE_BIN" -p "/pr-fix $n --unattended" $CLAUDE_FLAGS || { log "claude exited non-zero for #$n"; exit 0; }

new_tip="$(gh pr view "$n" -R "$REPO" --json headRefOid -q .headRefOid)"
if [ "$new_tip" = "$old_tip" ]; then log "#$n head unchanged after fix"; exit 0; fi
log "#$n pushed ${new_tip:0:9}; restacking PRs above"

# 3b. restack: each PR above rebases onto its (new) base, dropping the base's old commits.
git fetch -q origin
prev_head="$head"; prev_old="$old_tip"
for row in $(jq -c '.[]' <<<"$above"); do
  m="$(jq -r .number <<<"$row")"; h="$(jq -r .headRefName <<<"$row")"; oldh="$(jq -r .headRefOid <<<"$row")"
  wt="$(mktemp -d "${TMPDIR:-/tmp}/epic-restack.XXXXXX")"
  if git worktree add -q --detach "$wt" "origin/$h" &&
    git -C "$wt" rebase -q --onto "origin/$prev_head" "$prev_old" HEAD &&
    git -C "$wt" push -q --force-with-lease="$h:$oldh" origin "HEAD:refs/heads/$h"; then
    log "restacked #$m"
  else
    git -C "$wt" rebase --abort 2>/dev/null || true
    log "restack of #$m hit a conflict — next tick hands it to /pr-fix"
    gh pr comment "$m" -R "$REPO" --body "epic-watch: restack onto \`$prev_head\` conflicted; will be fixed unattended. If the rebase needs to be redone, use \`git rebase --onto origin/$prev_head ${prev_old:0:12} $h\`." >/dev/null 2>&1 || true
    git worktree remove --force "$wt" 2>/dev/null; break
  fi
  git worktree remove --force "$wt" 2>/dev/null
  prev_head="$h"; prev_old="$oldh"
done
