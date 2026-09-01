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
- **Role Guards:** Always test both allowed and denied scenarios for every `@Roles()` endpoint.
- **Context Header:** Always test missing and invalid `X-Tenant-ID` scenarios.

## Running Tests

```bash
# All tests
yarn test

# Unit tests only
yarn test:unit

# Integration tests (real database, runs sequentially)
yarn test:integration

# E2E tests (full HTTP stack, runs sequentially)
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

## Execution

- Run `yarn test:cov` before any PR to ensure coverage thresholds are met.
- If coverage drops, either add more tests or justify the drop in code review.
- Integration and E2E tests must run sequentially (one file at a time) to avoid database conflicts — Vitest's `--runInBand` equivalent is `--no-file-parallelism` (or `test.fileParallelism: false` in config, which `server/vitest.config.ts` already sets). Vitest's docs note that `fileParallelism: false` also forces `maxWorkers` to `1`, so no worker-count option is needed alongside it. Vitest 4 removed `test.poolOptions`, so the old `poolOptions.threads.singleThread` setting no longer exists.
- Migrations and baseline seed data run once per `vitest run` invocation (`server/test/global-setup.ts`), not once per spec file. Each run drops the test database, re-migrates, and seeds; the teardown drops it again at the end, so no schema survives between runs and you never need a manual reset after editing a migration.
- Spec files that build their own TypeORM connection with `{ synchronize: true, dropSchema: true }` rebuild the schema from entity metadata, which silently destroys migration-only objects (the `refresh_tokens` table, the `audit_logs` append-only trigger, `typeorm_migrations`). `server/test/setup.ts`'s `repairSchemaIfDamaged()` detects this and re-migrates so the next file is unaffected. Prefer not to add new specs that use `dropSchema` — they make the suite slower and the isolation harder to reason about.
