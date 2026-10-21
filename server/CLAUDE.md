# NestJS Testing Standards

## Core Principle

Every new Controller, Service, Guard, or Utility MUST include corresponding test files. Tests are non-negotiable.

## File Naming Convention

- Unit tests: `*.spec.ts`
- Integration tests (real DB): `*.integration.spec.ts`
- E2E tests (HTTP): `*.e2e-spec.ts`

## Test Runner

This project uses **vitest** (not jest). All test configuration is in `server/vitest.config.ts`.

## Coverage Targets (Minimum)

- Tenant Resolution: 95%
- Authorization (Roles/Guards): 95%
- Repository Layer: 85%
- Services: 85%
- Controllers: 60%
- Utilities: 80%
- Guards/Middleware: 90%

## Simplicity Rule

Tests must be readable by a junior developer. No dynamic test generation. Use explicit `describe` and `it` blocks. Add comments explaining business-critical assertions.

## Mandatory Scenarios

- **Tenant Isolation:** Always test that a user from Tenant A cannot access Tenant B's data.
- **Soft Deletes:** Always test that `deletedAt` is set and excluded from standard queries.
- **Role Guards:** Always test both allowed and denied scenarios for every `@Roles()` **and `@RequirePermissions()`** endpoint.
- **Context Header:** Always test missing and invalid `X-Tenant-ID` scenarios.
- **Permissions:** New tenant routes must declare `@RequirePermissions()`, or `@AuthenticatedOnly()` **plus** a reviewed entry in `IDENTITY_SCOPED`; `PermissionsGuard` fails closed (403) and `permission-matrix.e2e-spec.ts` fails otherwise. Every route's permission is also recorded in `src/__snapshots__/route-permissions.txt`. After adding or changing a route, run `yarn test:file src/permission-matrix.e2e-spec.ts -u` and commit the diff; reviewers read it like a permission change. The snapshot covers controller routes only: Swagger docs, static files and the SPA fallback in `main.ts` are not in it.
- **Teacher scope** ([Rule 2](../docs/architecture/08-security.md#rule-2-teacher-reads-are-scoped-to-assigned-sections)): the assigned section returns 200, another section's record returns 404, and a teacher with no assignment gets an empty list. Example: `src/teacher-section-scope.e2e-spec.ts`.
- **Session cut-off** ([Rule 8](../docs/architecture/08-security.md#rule-8-suspend-remove-or-reset-bumps-tokens_valid_after)): after a suspend, remove or reset, the user's old access token returns 401 on the next request. Example: `session-cutoff.service.integration.spec.ts`.
- **Non-UUID id** ([Rule 3](../docs/architecture/08-security.md#rule-3-every-id-path-param-goes-through-parseuuidpipe)): a non-UUID `:id` returns 400. Example: `GET /api/v1/students/not-a-uuid` → 400; `src/param-uuid-coverage.spec.ts` fails on a new param with no pipe.
- **Redis down** ([Rule 15](../docs/architecture/08-security.md#rule-15-redis-down-has-a-written-answer-per-route)): an `/auth/*` route marked `@FailClosedWithoutRedis()`, with the throttler store stubbed to throw, returns 503. A new `/auth*` or `/account*` route is listed in `test/helpers/redis-outage-routes.ts`. Example: `app-throttler.guard.e2e-spec.ts`.
- **Upload signature** ([Rule 6](../docs/architecture/08-security.md#rule-6-uploads-are-checked-by-file-signature)): an upload whose bytes do not match its declared type returns 4xx and stores nothing. Example: `homework-submission.controller.e2e-spec.ts`.
- **Snapshot** ([Rule 20](../docs/architecture/08-security.md#rule-20-a-reachability-change-updates-the-route-snapshot)): a change in who can reach a route updates `src/route-status.snapshot.txt`, and the PR explains each changed line (next section).

## Route status snapshot

`src/route-status.snapshot.txt` records what the guards answer for every route and every role (plus `ANON`, no token). `src/route-status-snapshot.e2e-spec.ts` sends the real request; a test-only interceptor stops it after the guards, so no handler runs.

```text
GET  /api/v1/platform/attention/health   401 PASS 403 403 ...   # ANON SUPER_ADMIN ADMIN ...
```

`PASS` = all guards let it through; otherwise the status code. Pipes, services, `X-Health-Token` and anything wired only in `main.ts` (helmet, CORS, cookie parsing, docs auth, `AllExceptionsFilter`) or nginx are not in it.

`PLATFORM_SA` is SUPER_ADMIN on the platform tenant (the real console); `TENANT_SA` is a SUPER_ADMIN membership on an ordinary school (legacy shape).

- **When it fails:** any change to who can reach a route changes a line. In CI (`CI=1`) a changed or missing file fails with the diff.
- **Update:** `yarn workspace @biddaloy/server test:file src/route-status-snapshot.e2e-spec.ts -u` (with the e2e database env, e.g. `yarn test-env run -- ...`). Commit the file in the same PR and list each changed line in the PR description next to the ticket or decision that intends it.
- **Reviewers:** a changed line no ticket asked for is a bug. New routes add lines and removed routes drop lines; both are expected.

## Minting an approval token in a spec

Any route behind `@RequireApproval(scope)` (e.g. `payments.reverse`,
`fees.discount`, `discount_rules.manage` — see
[docs/architecture/02-auth-and-multitenancy.md](../docs/architecture/02-auth-and-multitenancy.md))
needs a real `X-Approval-Token` to test the success path, not just the 403. Do the actual step-up flow rather than hand-crafting a JWT — set
`ACCOUNT_ACCESS_ECHO_SECRETS=true` in the test env so `POST
/auth/step-up/otp/request` echoes the OTP back in `response.body.debug.otp`
(this flag only works when `NODE_ENV=test`), then verify it:

```ts
async function issueApprovalToken(scope: string, identifier: string) {
  const { body } = await supertest(app.getHttpServer())
    .post(`${API}/auth/step-up/otp/request`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('X-Tenant-ID', SEED_TENANT_ID)
    .send({ identifier, scope })
    .expect(202);
  const verifyRes = await supertest(app.getHttpServer())
    .post(`${API}/auth/step-up`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('X-Tenant-ID', SEED_TENANT_ID)
    .send({ identifier, method: 'OTP', otp: body.debug.otp, scope })
    .expect(200);
  return verifyRes.body.approval_token;
}
```

The token is bound to the actor who verified it — `adminToken` here must
be the same user that goes on to spend the token, not an unrelated one.
`StepUpService.verify`'s rate limiter is keyed per-actor (5 attempts / 15
minutes) and is **not flushed between test files** — running many
approval-gated specs together can exhaust it and produce spurious 429s
that look like a real failure. `redis-cli FLUSHALL` between local runs
if you hit this; CI runs each file in a fresh container so it doesn't
see it. A handful of specs currently duplicate this helper locally
(`checkout.controller.e2e-spec.ts`, `discount-rules.controller.e2e-spec.ts`,
others) rather than sharing one from `test/helpers/` — worth consolidating
if a fourth or fifth copy shows up.

## Running Tests

```bash
# All tests
yarn test

# Unit tests only
yarn test:unit

# Integration tests (real database, 4 workers on per-worker databases)
yarn test:integration

# E2E tests (full HTTP stack, 4 workers on per-worker databases)
yarn test:e2e

# Coverage report
yarn test:cov

# Single file
yarn test:file -- src/students/students.service.integration.spec.ts
```

## Integration Test Database

Integration and E2E tests require a running PostgreSQL database.
Create `server/.env.test` with `DATABASE_URL` pointing to your test database.
The test database must exist before running tests.
A new migration must pass `test/migration-schema.integration.spec.ts` (no drift from the entity files beyond the exact statements in `test/schema-drift-baseline.ts`, and a down/up round-trip), so its `down()` must work on an empty database. Fixing a baselined drift means deleting its statement from that file.

## Execution

- Run `yarn test:cov` before any PR to ensure coverage thresholds are met.
- If coverage drops, either add more tests or justify the drop in code review.
- [18.2.1] Integration and E2E tests run in parallel across 4 workers (`server/vitest.config.ts`'s `maxWorkers`), each on its own Postgres database (cloned from a migrated template — `biddaloy_test_w1`..`w4`, see `server/test/global-setup.ts`) and its own Redis db index (`server/test/setup.ts`). A file never needs to avoid another file's data — they're on different databases — but tests within one file still share that worker's database, so don't rely on cross-file isolation within a single spec.
- Migrations and baseline seed data run once per `vitest run` invocation (`server/test/global-setup.ts`), not once per spec file. Each run drops the test database, re-migrates, and seeds; the teardown drops it again at the end, so no schema survives between runs and you never need a manual reset after editing a migration.
- Spec files that build their own TypeORM connection with `{ synchronize: true, dropSchema: true }` rebuild the schema from entity metadata, which silently destroys migration-only objects (the `refresh_tokens` table, the `audit_logs` append-only trigger, `typeorm_migrations`). `server/test/setup.ts`'s `repairSchemaIfDamaged()` detects this and re-migrates so the next file is unaffected. Prefer not to add new specs that use `dropSchema` — they make the suite slower and the isolation harder to reason about.

Dashboard widgets (`*-dashboard.controller.ts`, `@DashboardWidgetRoute`): see [docs/architecture/26-dashboard.md](../docs/architecture/26-dashboard.md).

## Test flake standards (Epic 2642, D18)

- No sleeps. Wait for a condition, never a duration.
- Create your own data with a unique suffix; never read a row another spec made.
- Concurrency tests use a deterministic hold (a latch or a held promise), not timing.
- Dates come from `todayInSchoolTz` or are fixed, never `new Date()` near midnight.
- A spec that touches a global table runs serial.
- A spec that calls attention rules by hand closes the attention worker first.
- A new concurrency spec passes five runs in a row; evidence goes in the PR.
- A spec that fails only under load is rerun alone (`yarn test-env run`) before it is judged.
