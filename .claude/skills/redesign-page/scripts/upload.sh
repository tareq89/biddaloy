#!/usr/bin/env bash
# Usage: upload.sh <slug> <image>...
#
# Puts the images on the orphan `design-assets` branch through the GitHub API
# and prints one URL per image, in the order given, ready for <img src="...">.
#
# Why a branch: `gh` cannot attach an image to an issue. Why the API: no local
# git state is touched, and an orphan branch has no workflows, so no CI runs.
#
# Example:
#   upload.sh calendar /tmp/x/desktop.png /tmp/x/mobile.png
#   -> https://github.com/tareq89/biddaloy/blob/design-assets/redesign/calendar/20261004-101500-desktop.png?raw=true
set -euo pipefail

slug=${1:?usage: upload.sh <slug> <image>...}
shift
[ $# -gt 0 ] || { echo "usage: upload.sh <slug> <image>..." >&2; exit 2; }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
branch=design-assets

if ! gh api "repos/$repo/git/ref/heads/$branch" --silent 2>/dev/null; then
  blob=$(gh api "repos/$repo/git/blobs" -f content="Mockup screenshots posted by the redesign-page skill." -q .sha)
  tree=$(jq -n --arg sha "$blob" '{tree: [{path: "README.md", mode: "100644", type: "blob", sha: $sha}]}' |
    gh api "repos/$repo/git/trees" --input - -q .sha)
  commit=$(gh api "repos/$repo/git/commits" -f message="chore: start design-assets branch" -f tree="$tree" -q .sha)
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" --silent
fi

stamp=$(date +%Y%m%d-%H%M%S)
for file in "$@"; do
  name=$(basename "$file")
  path="redesign/$slug/$stamp-$name"
  jq -n --arg message "design: $slug mockup ($name)" --arg branch "$branch" \
    --rawfile content <(base64 <"$file" | tr -d '\n') \
    '{message: $message, branch: $branch, content: $content}' |
    gh api -X PUT "repos/$repo/contents/$path" --input - --silent
  echo "https://github.com/$repo/blob/$branch/$path?raw=true"
done
