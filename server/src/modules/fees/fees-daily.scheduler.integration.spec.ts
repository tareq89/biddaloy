import { describe, it } from 'vitest';

/**
 * [16.7.2] Real-DB coverage for `FeesDailyScheduler` needs the
 * `recurring_schedules` / `recurring_schedule_structures` /
 * `recurring_schedule_exclusions` tables and the `FeeGeneration` module's
 * FK to them — all owned by #675 ([16.7.1], `RecurringSchedule`
 * entity/migration), which had not merged to `main` when this ticket
 * (#676) was implemented. `fees-daily.scheduler.ts` is built against
 * #676's documented raw-SQL contract for those tables (see the file's
 * top-of-file comment), so this suite cannot run against a real Postgres
 * until #675's migration exists on this branch.
 *
 * Unit coverage (`fees-daily.scheduler.spec.ts`) already exercises the
 * scheduling, per-schedule transaction/idempotency, and per-tenant/
 * per-schedule isolation logic against mocked `DataSource`/`EntityManager`
 * calls that match this contract exactly.
 *
 * TODO(#675 merge): un-skip, seed real `recurring_schedules` rows via
 * #675's service/migration, and assert against real `FeeGeneration` rows
 * (idempotency via `last_run_period`, `SCHEDULE` source, notify_families
 * threading) the way `fee-generation.service.integration.spec.ts` does for
 * `MANUAL` generation.
 */
describe.skip('FeesDailyScheduler (integration, blocked on #675)', () => {
  it('runs due schedules and writes FeeGeneration rows with source SCHEDULE', () => {
    // Intentionally empty — see file header.
  });
});
