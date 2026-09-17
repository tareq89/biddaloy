#!/usr/bin/env bash
#
# [18.4.1] Creates or updates the `main-gate` repository ruleset: required
# status checks + merge queue on `main`. Idempotent — re-running with no
# changes reports "unchanged" and exits 0, so it's safe to re-run after
# every edit to this file, and safe to wire into a one-off manual step.
#
# Usage:
#   scripts/apply-main-ruleset.sh
#
# Requires `gh` authenticated against the target repo (`gh auth status`),
# with `admin:org`/repo-admin rights to read and write rulesets. Reads the
# owner/repo from `gh repo view` (i.e. the repo checked out in the current
# directory) rather than a hardcoded slug.
set -euo pipefail

RULESET_NAME="main-gate"

repo_slug="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

# GitHub's ruleset JSON body. `required_status_checks` names must match the
# job `name:` (not the YAML key) as reported to the Checks API — see
# ci.yml's `verify`/`frontend`/`integration`/`e2e` job `name:` fields.
desired_body="$(
  cat <<'JSON'
{
  "name": "main-gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Build, lint, unit tests" },
          { "context": "Frontend tests" },
          { "context": "Integration & e2e tests" },
          { "context": "E2E smoke (chromium)" },
          { "context": "Route sweeps (chromium-sweeps)" },
          { "context": "Nightly quality (merge queue) / Lighthouse (3G budgets)" }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "max_entries_to_build": 5,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 0,
        "check_response_timeout_minutes": 30,
        "grouping_strategy": "ALLGREEN"
      }
    },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
)"

# Find an existing ruleset by name — rulesets are id-keyed, not name-keyed,
# so this is how we decide POST (create) vs PUT (update).
existing_id="$(
  gh api "repos/${repo_slug}/rulesets" --paginate \
    --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" \
    | head -n1
)"

if [ -z "${existing_id}" ]; then
  echo "Creating ruleset '${RULESET_NAME}' on ${repo_slug}..."
  gh api "repos/${repo_slug}/rulesets" \
    --method POST \
    --input - <<<"${desired_body}" >/dev/null
  echo "Created."
  exit 0
fi

# Idempotent update: compare the live ruleset's rule-bearing fields against
# the desired body before writing, so an unchanged re-run can say so instead
# of silently PUTting an identical body every time.
current_body="$(
  gh api "repos/${repo_slug}/rulesets/${existing_id}" \
    --jq '{name, target, enforcement, conditions, rules}'
)"
desired_compact="$(printf '%s' "${desired_body}" | jq -S '{name, target, enforcement, conditions, rules}')"
current_compact="$(printf '%s' "${current_body}" | jq -S '{name, target, enforcement, conditions, rules}')"

if [ "${current_compact}" = "${desired_compact}" ]; then
  echo "Ruleset '${RULESET_NAME}' (id ${existing_id}) on ${repo_slug}: unchanged."
  exit 0
fi

echo "Updating ruleset '${RULESET_NAME}' (id ${existing_id}) on ${repo_slug}..."
gh api "repos/${repo_slug}/rulesets/${existing_id}" \
  --method PUT \
  --input - <<<"${desired_body}" >/dev/null
echo "Updated."
