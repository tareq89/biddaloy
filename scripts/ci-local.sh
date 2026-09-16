#!/usr/bin/env bash
# Mirrors .github/workflows/ci.yml job-for-job — edit both together (#152).
# Sections run the same commands, in the same order, with no wrapping, so a
# failure here prints exactly what the CI job prints.
#
# Default:        verify + frontend + audit (no external services needed)
# --integration:  adds the integration section (self-provisions db+redis)
# --e2e:          adds the e2e section (self-provisions db+redis)
# --lighthouse:   adds the lighthouse section (self-provisions db+redis) —
#                 mirrors nightly-quality.yml's "lighthouse" job ([18.1.1]
#                 moved it off ci.yml's PR/push path onto a nightly
#                 schedule + workflow_dispatch; this flag's local shape is
#                 unchanged, only its CI counterpart moved)
# --storybook:    adds the storybook section (mirrors ci.yml's "Storybook
#                 build" job — PR-blocking in CI, opt-in here since it costs
#                 ~100s and most local runs don't touch Storybook content)
# --full:         everything, including --storybook
# --no-coverage:  frontend section runs yarn test:frontend --run instead of
#                 the coverage variant — faster, but NOT CI-equivalent (CI
#                 always collects coverage in the frontend job)
# --only a,b:     [18.4.3] run only the named section(s) — one of verify,
#                 frontend, storybook, integration, e2e, audit, lighthouse —
#                 instead of the default set / the flags above. Lets one CI
#                 job be replayed on its own.
# --affected:     [18.4.3] skip a section whose area (per the globs below,
#                 kept in sync with ci.yml's "changes" job) has no changes
#                 against origin/main — same job/area gating ci.yml itself
#                 uses (verify and audit are never gated, ci.yml runs them
#                 unconditionally too). Also passes --changed origin/main to
#                 the frontend section's vitest run.
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
ONLY_SET=0
ONLY_LIST=()
AFFECTED=0

usage() {
  echo "usage: $(basename "$0") [--integration] [--e2e] [--lighthouse] [--storybook] [--full] [--no-coverage] [--only <job,job,...>] [--affected]" >&2
  echo "  --only accepts: verify, frontend, storybook, integration, e2e, audit, lighthouse" >&2
}

VALID_JOBS="verify frontend storybook integration e2e audit lighthouse"

args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
  arg="${args[$i]}"
  case "$arg" in
    --integration) RUN_INTEGRATION=1 ;;
    --e2e) RUN_E2E=1 ;;
    --lighthouse) RUN_LIGHTHOUSE=1 ;;
    --storybook) RUN_STORYBOOK=1 ;;
    --full) RUN_INTEGRATION=1; RUN_E2E=1; RUN_LIGHTHOUSE=1; RUN_STORYBOOK=1 ;;
    --no-coverage) COVERAGE=0 ;;
    --affected) AFFECTED=1 ;;
    --only)
      i=$((i + 1))
      if [ $i -ge ${#args[@]} ]; then
        echo "--only requires a value" >&2
        usage
        exit 2
      fi
      ONLY_SET=1
      ONLY_LIST=()
      IFS=',' read -r -a ONLY_LIST <<< "${args[$i]}"
      for job in "${ONLY_LIST[@]}"; do
        case " $VALID_JOBS " in
          *" $job "*) : ;;
          *)
            echo "unknown --only job: $job" >&2
            usage
            exit 2
            ;;
        esac
      done
      ;;
    --only=*)
      ONLY_SET=1
      IFS=',' read -r -a ONLY_LIST <<< "${arg#--only=}"
      for job in "${ONLY_LIST[@]}"; do
        case " $VALID_JOBS " in
          *" $job "*) : ;;
          *)
            echo "unknown --only job: $job" >&2
            usage
            exit 2
            ;;
        esac
      done
      ;;
    *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
  esac
  i=$((i + 1))
done

# [18.4.3] Mirror of ci.yml's "changes" job path-filter globs — keep in
# sync by hand; see .github/workflows/ci.yml's `changes` job (#152 note
# above applies to this whole file).
CI_PATHS_FRONTEND=(
  'ui/**'
  'client-admin/**'
  'shared/**'
  'e2e/**'
  'scripts/coverage-offenders.mjs'
  'scripts/coverage-delta.mjs'
  'scripts/bundle-delta.mjs'
  'scripts/ci-timings.mjs'
  'scripts/ci-timings.spec.mjs'
  'scripts/ci-timings-trend.mjs'
  'scripts/ci-timings-trend.spec.mjs'
  'scripts/flake-report.mjs'
  'scripts/flake-report.spec.mjs'
  'ci-budgets.json'
  'quarantine.json'
  'package.json'
  'yarn.lock'
  'vitest.config.ts'
  'playwright.config.ts'
  '.github/workflows/ci.yml'
)
CI_PATHS_SERVER=(
  'server/**'
  'shared/**'
  'scripts/ci-timings.mjs'
  'scripts/ci-timings.spec.mjs'
  'scripts/ci-timings-trend.mjs'
  'scripts/ci-timings-trend.spec.mjs'
  'ci-budgets.json'
  'package.json'
  'yarn.lock'
  '.github/workflows/ci.yml'
)
CI_PATHS_UI=(
  'ui/**'
  'yarn.lock'
  'package.json'
)

CHANGED_FILES=()
if [ "$AFFECTED" = 1 ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && CHANGED_FILES+=("$line")
  done < <(git diff --name-only origin/main...HEAD)
fi

# path_matches(file, pattern) — dorny/paths-filter-style glob: a
# 'dir/**' pattern is a prefix match, anything else is an exact match.
path_matches() {
  local file="$1" pattern="$2" prefix
  case "$pattern" in
    *"/**")
      prefix="${pattern%/**}/"
      [[ "$file" == "$prefix"* ]]
      ;;
    *)
      [ "$file" = "$pattern" ]
      ;;
  esac
}

# area_touched(area) — true if any changed file matches that area's globs.
area_touched() {
  local area="$1" f p
  local -a patterns
  case "$area" in
    frontend) patterns=("${CI_PATHS_FRONTEND[@]}") ;;
    server) patterns=("${CI_PATHS_SERVER[@]}") ;;
    ui) patterns=("${CI_PATHS_UI[@]}") ;;
  esac
  # `set -u` treats an empty array's "${arr[@]}" as unbound on this
  # bash — guard the loop on the count instead of the expansion.
  [ ${#CHANGED_FILES[@]} -eq 0 ] && return 1
  for f in "${CHANGED_FILES[@]}"; do
    for p in "${patterns[@]}"; do
      path_matches "$f" "$p" && return 0
    done
  done
  return 1
}

# should_run(section) — decides whether a named section runs, folding in
# --only, the default/flag selection, and --affected area gating. Mirrors
# ci.yml's per-job `if: needs.changes.outputs...` conditions (verify and
# audit are unconditional there too).
should_run() {
  local name="$1"
  if [ "$ONLY_SET" = 1 ]; then
    local found=0 j
    for j in "${ONLY_LIST[@]}"; do
      [ "$j" = "$name" ] && found=1
    done
    [ "$found" = 1 ] || return 1
  else
    case "$name" in
      verify | frontend | audit) : ;;
      storybook) [ "$RUN_STORYBOOK" = 1 ] || return 1 ;;
      integration) [ "$RUN_INTEGRATION" = 1 ] || return 1 ;;
      e2e) [ "$RUN_E2E" = 1 ] || return 1 ;;
      lighthouse) [ "$RUN_LIGHTHOUSE" = 1 ] || return 1 ;;
    esac
  fi
  if [ "$AFFECTED" = 1 ]; then
    case "$name" in
      # ci.yml's "frontend" and "e2e" jobs both gate on the `frontend` area
      # (see ci.yml's line-519 comment on the e2e job).
      frontend | e2e)
        area_touched frontend || return 1
        ;;
      # ci.yml's "integration" job gates on `server || api-surface`. There's
      # no CI_PATHS_API_SURFACE array here — `api-surface` is `server/src/**`
      # (already inside CI_PATHS_SERVER) plus `ui/src/api/**` (a small slice
      # of CI_PATHS_FRONTEND's much wider `ui/**`). Gating on the full
      # `frontend` area here would over-run integration on client-admin/e2e/
      # shared-only branches ci.yml's real job would skip — so this checks
      # `server` only, which slightly under-approximates the `ui/src/api/**`
      # sliver of api-surface but never over-runs relative to ci.yml.
      integration)
        area_touched server || return 1
        ;;
      storybook)
        area_touched ui || return 1
        ;;
      # verify, audit, lighthouse: no ci.yml area gating to mirror.
    esac
  fi
  return 0
}

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
  # [15.5] `minio`/`minio-init` too — `StorageModule` is a boot-time
  # dependency of `AppModule` now (`docs:generate`/`seed` below both boot
  # it), and the logo e2e spec needs real object storage, same reasoning
  # as ci.yml's "integration" job.
  docker compose up -d db redis minio
  # `minio-init` is a one-shot `mc mb --ignore-existing`. Run it in the
  # foreground rather than via `up -d`, which returns once it has *started*,
  # not finished: `run` waits for `minio` to be healthy (its `depends_on`),
  # blocks until `mc` exits, and propagates a non-zero exit through `set -e`,
  # so the bucket exists before anything uploads to it. (Not `docker compose
  # wait` — on Compose v2.20 that reports "no containers for project" and
  # exits 1 when the one-shot container has already finished, a false
  # negative on every fast machine.)
  docker compose run --rm minio-init
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
  # docker-compose.yml's own S3_* — the compose `minio` service listens on
  # the compose network as `minio:9000`, exposed to the host at
  # localhost:9000 (see that file's own port mapping comment).
  export S3_ENDPOINT=http://localhost:9000
  export S3_REGION=us-east-1
  export S3_BUCKET=${S3_BUCKET:-biddaloy}
  export S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:-change-me}
  export S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-change-me}
  export S3_FORCE_PATH_STYLE=true
  export S3_ALLOW_INSECURE_HTTP=true
}

if should_run "verify"; then
  section "verify"
  yarn install --frozen-lockfile
  yarn build:shared
  yarn build:server
  # [18.4.3] mirrors 18.4.1's typecheck change: one `yarn typecheck` (root
  # `tsc -b`, which already references shared/ui/client-admin/
  # client-admin's sw project/server's lint project/e2e — see root
  # tsconfig.json) instead of the four separate tsc calls `yarn lint`,
  # `yarn workspace @biddaloy/ui lint`, `yarn workspace @biddaloy/client-admin
  # lint` (two tsc passes) and `npx tsc -p e2e/tsconfig.json` used to run
  # one at a time. eslint isn't part of `tsc -b`, so it still runs on its
  # own for the two workspaces that lint it.
  yarn typecheck
  yarn workspace @biddaloy/ui eslint .
  yarn workspace @biddaloy/client-admin eslint .
  yarn test:unit
  yarn workspace @biddaloy/client-admin check:route-chunks
  yarn workspace @biddaloy/ui check:exports
  yarn workspace @biddaloy/ui check:contrast
  yarn workspace @biddaloy/ui check:raw-palette
  yarn workspace @biddaloy/ui check:i18n
  yarn knip || echo "knip: non-blocking, exactly as in CI"
  section_done "verify"
fi

if should_run "frontend"; then
  section "frontend"
  # [#437] ci.yml also runs the quarantined tests non-blockingly here
  # (`QUARANTINE_MODE=only`, guarded on quarantine.json being non-empty) —
  # deliberately not mirrored locally: on an empty list it would still spend
  # a second near-full frontend run transforming/importing ~200 files for
  # zero information, the same cost ci.yml's own comment on that step flags.
  FRONTEND_EXTRA_ARGS=()
  if [ "$AFFECTED" = 1 ]; then
    FRONTEND_EXTRA_ARGS=(--changed origin/main)
  fi
  if [ "$COVERAGE" = 1 ]; then
    yarn test:frontend:coverage "${FRONTEND_EXTRA_ARGS[@]}"
  else
    yarn test:frontend --run "${FRONTEND_EXTRA_ARGS[@]}"
  fi
  section_done "frontend"
fi

if should_run "storybook"; then
  section "storybook"
  yarn workspace @biddaloy/ui build-storybook
  section_done "storybook"
fi

if should_run "integration"; then
  section "integration"
  provision_stack
  yarn workspace @biddaloy/server docs:generate
  yarn workspace @biddaloy/ui check:api-types
  yarn test:integration
  yarn test:e2e
  section_done "integration"
fi

if should_run "e2e"; then
  section "e2e"
  provision_stack
  yarn workspace @biddaloy/server migration:run
  yarn workspace @biddaloy/server seed
  # CI=1 mirrors the pipeline and stops playwright.config.ts's
  # reuseExistingServer from grabbing an already-running dev server wired
  # to the dev database — that mismatch fails login against the freshly
  # seeded biddaloy_ci_local. If dev servers hold ports 3000/5174,
  # Playwright now fails fast with a clear port-in-use message instead.
  # Mirrors ci.yml's "e2e" job (18.2.3): chromium project plus the PWA
  # suite, no sharding.
  #
  # #766: deliberately NOT setting E2E_SKIP_BUILD here, unlike ci.yml's e2e
  # job. That job skips its build because it downloads verify's build-dist
  # artifact; there's no equivalent artifact-download step locally, and
  # e2e:serve:client's build is the only thing that ever produces
  # client-admin/dist in this script (check:route-chunks above builds into
  # its own temp dir, not client-admin/dist). Setting it here would silently
  # serve a stale or missing dist instead of failing loudly.
  CI=1 yarn e2e --project=chromium && CI=1 yarn e2e:pwa
  section_done "e2e"
fi

if should_run "lighthouse"; then
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

if should_run "audit"; then
  section "audit"
  node scripts/ci-audit.js
  section_done "audit"
fi

echo ""
echo "=== summary ==="
if [ ${#SUMMARY[@]} -gt 0 ]; then
  for line in "${SUMMARY[@]}"; do echo "  $line"; done
else
  echo "  (no sections ran — check --only/--affected)"
fi
