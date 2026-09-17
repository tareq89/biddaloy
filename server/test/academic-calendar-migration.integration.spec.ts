import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicCalendar1789600000000 } from '../src/migrations/1789600000000-AcademicCalendar';

/**
 * [17.1.2] Runs the academic-calendar migration's `up`/`down` directly
 * against the test database (already migrated once by
 * `server/test/global-setup.ts`, which includes this migration). We run
 * `down` then `up` here to prove both directions actually work, then leave
 * the schema in the "up" state for any later spec file in the same
 * `vitest run` invocation.
 *
 * The row-preservation/backfill assertions and the down()/up() round trip
 * live in one `it` rather than split across several: `test/setup.ts`'s
 * global per-test reset clears every transactional table (including the
 * calendar ones) between tests, which would delete the fixture row before
 * a later test could see it, and would also fail outright with "relation
 * does not exist" if it landed while `down()` has the calendar tables
 * dropped.
 */
describe('AcademicCalendar1789600000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AcademicCalendar1789600000000();

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function tableExists(name: string): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await dataSource.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [name],
    );
    return rows[0].exists;
  }

  it('is up after global migrations run: calendar_events exists, school_holidays does not', async () => {
    expect(await tableExists('calendar_events')).toBe(true);
    expect(await tableExists('school_holidays')).toBe(false);
    expect(await tableExists('academic_terms')).toBe(true);
    expect(await tableExists('public_holiday_sets')).toBe(true);
    expect(await tableExists('public_holiday_entries')).toBe(true);
    expect(await tableExists('calendar_feed_tokens')).toBe(true);
  });

  it(
    'rename preserves rows and backfills type/published_at; exclusion constraint rejects an ' +
      'overlapping term; feed-token unique-active index holds',
    async () => {
      const [year] = await dataSource.query(
        `INSERT INTO "academic_years" (id, name, start_date, end_date, tenant_id) VALUES (gen_random_uuid(), 'Migration Test Year', '2026-01-01', '2026-12-31', $1) RETURNING id`,
        [TENANT_ID],
      );
      const [row] = await dataSource.query(
        `INSERT INTO "calendar_events" (id, tenant_id, academic_year_id, start_date, end_date, name, counts_as_working_day) VALUES (gen_random_uuid(), $1, $2, '2026-11-01', '2026-11-01', 'Pre-existing Holiday', false) RETURNING id, type, published_at`,
        [TENANT_ID, year.id],
      );
      expect(row.type).toBe('HOLIDAY');
      // published_at is only backfilled by the migration's own UPDATE for
      // rows that already existed when it ran — a row inserted while the
      // schema is already "up" has none applied to it, so it's null here.
      expect(row.published_at).toBeNull();

      // down(): renames calendar_events back to school_holidays (preserving
      // the row above) and drops every new table/column. Wrapped in
      // try/finally: if any assertion below throws while the schema is
      // "down", global-setup's per-test reset (test/reset-order.ts) would
      // otherwise fail with "relation does not exist" for every later spec
      // file sharing this worker's database — re-running up() unconditionally
      // restores the schema regardless of where the failure happened.
      await migration.down(queryRunner);
      try {
        expect(await tableExists('school_holidays')).toBe(true);
        expect(await tableExists('calendar_events')).toBe(false);
        expect(await tableExists('academic_terms')).toBe(false);
        expect(await tableExists('public_holiday_sets')).toBe(false);
        expect(await tableExists('public_holiday_entries')).toBe(false);
        expect(await tableExists('calendar_feed_tokens')).toBe(false);
        expect(await tableExists('calendar_event_classes')).toBe(false);

        const droppedColumnRows: Array<{ column_name: string }> = await dataSource.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'school_holidays' AND column_name IN ('type', 'published_at', 'audience')`,
        );
        expect(droppedColumnRows).toEqual([]);

        const [preservedRow] = await dataSource.query(
          `SELECT id FROM "school_holidays" WHERE id = $1`,
          [row.id],
        );
        expect(preservedRow.id).toBe(row.id);
      } finally {
        // up(): re-applies the rename, and this row — now genuinely
        // "pre-existing" from the migration's point of view — gets
        // type/published_at backfilled exactly like a real pre-migration row
        // would.
        await migration.up(queryRunner);
      }

      expect(await tableExists('calendar_events')).toBe(true);
      expect(await tableExists('school_holidays')).toBe(false);

      const [backfilled] = await dataSource.query(
        `SELECT type, published_at, created_at FROM "calendar_events" WHERE id = $1`,
        [row.id],
      );
      expect(backfilled.type).toBe('HOLIDAY');
      expect(new Date(backfilled.published_at).getTime()).toBe(
        new Date(backfilled.created_at).getTime(),
      );

      // Exclusion constraint rejects an overlapping term in the same
      // academic year (D5).
      await dataSource.query(
        `INSERT INTO "academic_terms" (id, tenant_id, academic_year_id, seq, name, start_date, end_date) VALUES (gen_random_uuid(), $1, $2, 1, 'Term 1', '2026-01-01', '2026-06-01')`,
        [TENANT_ID, year.id],
      );
      await expect(
        dataSource.query(
          `INSERT INTO "academic_terms" (id, tenant_id, academic_year_id, seq, name, start_date, end_date) VALUES (gen_random_uuid(), $1, $2, 2, 'Term 2 (overlapping)', '2026-05-01', '2026-08-01')`,
          [TENANT_ID, year.id],
        ),
      ).rejects.toThrow();

      // Feed-token unique-active index: a second active token for the same
      // (tenant_id, user_id) is rejected; a second *revoked* one would be
      // fine (D13) but isn't needed to prove the constraint here.
      const userId = '00000000-0000-4000-8000-000000000010';
      await dataSource.query(
        `INSERT INTO "calendar_feed_tokens" (id, tenant_id, user_id, token_hash) VALUES (gen_random_uuid(), $1, $2, repeat('a', 64))`,
        [TENANT_ID, userId],
      );
      await expect(
        dataSource.query(
          `INSERT INTO "calendar_feed_tokens" (id, tenant_id, user_id, token_hash) VALUES (gen_random_uuid(), $1, $2, repeat('b', 64))`,
          [TENANT_ID, userId],
        ),
      ).rejects.toThrow();
    },
  );
});
