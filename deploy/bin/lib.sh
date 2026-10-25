# shellcheck shell=bash
# Sourced by biddaloy-nightly, biddaloy-doctor and biddaloy-restore-prod (needs ROOT and REPO).
#
# kept_file <stack> <name> <path in the checkout>: the copy that stack's last ok deploy kept in
# $ROOT/<stack>/ (deploy.yml keeps stack.yml and smoke-post-deploy.mjs), else the checkout's file
# (only before a first ok deploy). The checkout follows whatever stack was deployed last, so a
# host script must not run a stack with it.
kept_file() { if [[ -f "$ROOT/$1/$2" ]]; then printf '%s\n' "$ROOT/$1/$2"; else printf '%s\n' "$REPO/$3"; fi; }
