#!/usr/bin/env bash
# Create an epic + its sub-issues from a directory of markdown bodies,
# link them as native sub-issues, and add all of them to a GitHub project.
#
#   create-epic.sh <dir> [--project <number>] [--repo <owner/name>]
#
# <dir> must contain:
#   epic.md                 first line "# Epic <N> — <title>" → issue title is everything after "# "
#   <anything-else>.md      first line "# <title>" (or "## Goal" → title from filename); rest is the body
# Sub-issues are created in filename sort order, so name them w1-01-…, w1-02-…, w2-01-….
set -euo pipefail

dir=""; project=""; repo=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --repo)    repo="$2";    shift 2 ;;
    *)         dir="$1";     shift ;;
  esac
done
[[ -d "$dir" && -f "$dir/epic.md" ]] || { echo "usage: $0 <dir-with-epic.md> [--project N] [--repo o/r]" >&2; exit 1; }
repo="${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
owner="${repo%%/*}"

title_of() {
  local f="$1" first
  first="$(head -n1 "$f")"
  if [[ "$first" == "# "* ]]; then echo "${first#\# }"; else basename "$f" .md; fi
}
body_of() {
  local f="$1"
  if [[ "$(head -n1 "$f")" == "# "* ]]; then tail -n +2 "$f"; else cat "$f"; fi
}

create_issue() { # title bodyfile → number
  gh issue create --repo "$repo" --title "$1" --body-file "$2" | grep -oE '[0-9]+$'
}

# Tolerant on purpose: the project's auto-add workflow usually adds new issues
# before we do, and `gh project item-add` then fails with "Content already
# exists in this project" — under `set -e` that aborted the run mid-epic (#814).
add_to_project() { # url
  [[ -n "$project" ]] || return 0
  gh project item-add "$project" --owner "$owner" --url "$1" >/dev/null 2>&1 \
    || echo "note: $1 not added to project $project (already there?)" >&2
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

body_of "$dir/epic.md" > "$tmp/epic.body"
epic_no="$(create_issue "$(title_of "$dir/epic.md")" "$tmp/epic.body")"
echo "${epic_no}|$(title_of "$dir/epic.md")|https://github.com/$repo/issues/$epic_no"
add_to_project "https://github.com/$repo/issues/$epic_no"

for f in "$dir"/*.md; do
  [[ "$(basename "$f")" == "epic.md" ]] && continue
  t="$(title_of "$f")"
  body_of "$f" > "$tmp/sub.body"
  no="$(create_issue "$t" "$tmp/sub.body")"
  id="$(gh api "repos/$repo/issues/$no" --jq .id)"
  gh api -X POST "repos/$repo/issues/$epic_no/sub_issues" -F sub_issue_id="$id" >/dev/null
  add_to_project "https://github.com/$repo/issues/$no"
  echo "${no}|${t}|https://github.com/$repo/issues/$no"
done
