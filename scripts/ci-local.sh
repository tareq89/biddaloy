#!/usr/bin/env bash
# Mirrors .github/workflows/ci.yml job-for-job — edit both together (#152).
# Sections run the same commands, in the same order, with no wrapping, so a
# failure here prints exactly what the CI job prints.
#
# Default:        verify + frontend + audit (no external services needed)
# --integration:  adds the integration section (self-provisions db+redis)
# --e2e:          adds the e2e section (self-provisions db+redis)
# --lighthouse:   adds the lighthouse section (self-provisions db+redis)
# --storybook:    adds the storybook section (mirrors ci.yml's "Storybook
#                 build" job — PR-blocking in CI, opt-in here since it costs
#                 ~100s and most local runs don't touch Storybook content)
# --full:         everything, including --storybook
# --no-coverage:  frontend section runs yarn test:frontend --run instead of
#                 the coverage variant — faster, but NOT CI-equivalent (CI
#                 always collects coverage in the frontend job)
#
# Deliberately NOT mirrored here — see #441's PR description for why:
#   - bundle-delta (ci.yml's "bundle-delta" job): PR-comment-only, reads two
#     already-built reports and diffs them; nothing to reproduce locally
#     that check:route-chunks below doesn't already cover.
#   - codeql (.github/workflows/codeql.yml): GitHub-hosted static analysis,
#     no local equivalent to run.
set -euo pipefail
cd "$(dirname "$0")/.."

# [15.6] Fail fast, before any of the ~90s+ work below burns on the wrong
# Node major — see scripts/check-node-version.mjs's own header comment.
node scripts/check-node-version.mjs

RUN_INTEGRATION=0
RUN_E2E=0
RUN_LIGHTHOUSE=0
RUN_STORYBOOK=0
COVERAGE=1
for arg in "$@"; do
  case "$arg" in
    --integration) RUN_INTEGRATION=1 ;;
    --e2e) RUN_E2E=1 ;;
    --lighthouse) RUN_LIGHTHOUSE=1 ;;
    --storybook) RUN_STORYBOOK=1 ;;
    --full) RUN_INTEGRATION=1; RUN_E2E=1; RUN_LIGHTHOUSE=1; RUN_STORYBOOK=1 ;;
    --no-coverage) COVERAGE=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

SUMMARY=()
SECTION_START=0
section() {
  echo ""
  echo "=== $1 ==="
  SECTION_START=$(date +%s)
}
section_done() {
  SUMMARY+=("$1: $(($(date +%s) - SECTION_START))s")
}

# Dedicated DB name so this never clobbers a dev database. Env values
# mirror ci.yml's throwaway CI-only secrets — safe in a checked-in script.
provision_stack() {
  docker compose up -d db redis
  until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  docker compose exec -T db psql -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname = 'biddaloy_ci_local'" | grep -q 1 ||
    docker compose exec -T db psql -U postgres -c "CREATE DATABASE biddaloy_ci_local"
  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/biddaloy_ci_local
  export REDIS_URL=redis://localhost:6379
  export JWT_SECRET=ci-integration-jwt-secret-do-not-use-in-production-1234567890
  export NODE_ENV=test
  export SEED_ADMIN_PASSWORD=ci-integration-seed-password-123
  export SETTINGS_ENCRYPTION_KEY=YmSqNpwxzusjAF12JSD+JNe+3LXrbNJiQza2yTnQyR0=
}

section "verify"
yarn install --frozen-lockfile
yarn build:shared
yarn build:server
yarn lint
yarn test:unit
yarn workspace @biddaloy/ui lint
yarn workspace @biddaloy/client-admin lint
npx tsc -p e2e/tsconfig.json --noEmit
yarn workspace @biddaloy/client-admin check:route-chunks
yarn workspace @biddaloy/ui check:exports
yarn workspace @biddaloy/ui check:contrast
yarn workspace @biddaloy/ui check:raw-palette
yarn workspace @biddaloy/ui check:i18n
yarn knip || echo "knip: non-blocking, exactly as in CI"
section_done "verify"

section "frontend"
# [#437] ci.yml also runs the quarantined tests non-blockingly here
# (`QUARANTINE_MODE=only`, guarded on quarantine.json being non-empty) —
# deliberately not mirrored locally: on an empty list it would still spend
# a second near-full frontend run transforming/importing ~200 files for
# zero information, the same cost ci.yml's own comment on that step flags.
if [ "$COVERAGE" = 1 ]; then
  yarn test:frontend:coverage
else
  yarn test:frontend --run
fi
section_done "frontend"

if [ "$RUN_STORYBOOK" = 1 ]; then
  section "storybook"
  yarn workspace @biddaloy/ui build-storybook
  section_done "storybook"
fi

if [ "$RUN_INTEGRATION" = 1 ]; then
  section "integration"
  provision_stack
  yarn workspace @biddaloy/server docs:generate
  yarn workspace @biddaloy/ui check:api-types
  yarn test:integration
  yarn test:e2e
  section_done "integration"
fi

if [ "$RUN_E2E" = 1 ]; then
  section "e2e"
  provision_stack
  yarn workspace @biddaloy/server migration:run
  yarn workspace @biddaloy/server seed
  # CI=1 mirrors the pipeline and stops playwright.config.ts's
  # reuseExistingServer from grabbing an already-running dev server wired
  # to the dev database — that mismatch fails login against the freshly
  # seeded biddaloy_ci_local. If dev servers hold ports 3000/5174,
  # Playwright now fails fast with a clear port-in-use message instead.
  CI=1 yarn e2e
  section_done "e2e"
fi

if [ "$RUN_LIGHTHOUSE" = 1 ]; then
  section "lighthouse"
  provision_stack
  yarn workspace @biddaloy/server migration:run
  yarn workspace @biddaloy/server seed
  # Production builds on both sides, same as the CI lighthouse job —
  # never the dev servers.
  yarn build:server
  node server/dist/main.js &
  LH_SERVER_PID=$!
  cleanup_lighthouse() {
    kill "$LH_SERVER_PID" 2>/dev/null || true
    if [ -n "${LH_PREVIEW_PID:-}" ]; then
      kill "$LH_PREVIEW_PID" 2>/dev/null || true
    fi
  }
  trap cleanup_lighthouse EXIT
  yarn build:client-admin
  yarn workspace @biddaloy/client-admin preview --port 5174 &
  LH_PREVIEW_PID=$!
  npx wait-on tcp:3000 tcp:5174 --timeout 120000
  STUDENT_URL="$(node scripts/lighthouse-student-url.mjs)"
  npx lhci autorun \
    --collect.url=http://localhost:5174/login \
    --collect.url=http://localhost:5174/fees/dues \
    --collect.url="$STUDENT_URL"
  cleanup_lighthouse
  trap - EXIT
  section_done "lighthouse"
fi

section "audit"
node scripts/ci-audit.js
section_done "audit"

echo ""
echo "=== summary ==="
for line in "${SUMMARY[@]}"; do echo "  $line"; done
