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
- **Permissions:** New tenant routes must declare `@RequirePermissions()` or carry a reviewed entry in `IDENTITY_SCOPED`; `permission-matrix.e2e-spec.ts` fails otherwise. Every route's permission is also recorded in `src/__snapshots__/route-permissions.txt`. After adding or changing a route, run `yarn test:file src/permission-matrix.e2e-spec.ts -u` and commit the diff; reviewers read it like a permission change. The snapshot covers controller routes only: Swagger docs, static files and the SPA fallback in `main.ts` are not in it.

## Route status snapshot

`src/route-status.snapshot.txt` records what the guards answer for every route and every role (plus `ANON`, no token). `src/route-status-snapshot.e2e-spec.ts` sends the real request; a test-only interceptor stops it after the guards, so no handler runs.

```text
GET  /api/v1/platform/attention/health   401 PASS 403 403 ...   # ANON SUPER_ADMIN ADMIN ...
```

`PASS` = all guards let it through; otherwise the status code. Pipes, services and `X-Health-Token` are not in it.

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
    .send({ identifier })
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
