import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { EvaluationsAndPerformance1790900000000 } from '../src/migrations/1790900000000-EvaluationsAndPerformance';

/**
 * [28.1.2 / #1227] `down()` of the Epic 28.0 schema migration, which no other
 * spec exercised. Runs against the test database (already migrated once by
 * `server/test/global-setup.ts`). `down()` then `up()` run inside one
 * transaction that is rolled back at the end. A plain `up()` would rebuild
 * the tables as they were in 1790900000000 and lose every later column
 * (e.g. `staff_incidents.withdrawn_at` from 1791805000300), which broke the
 * next spec files on the same worker database. The rollback puts back the
 * exact schema the test started with.
 */
const TABLES = [
  'acr_form_versions',
  'acr_criteria',
  'acr_assessments',
  'acr_scores',
  'staff_incidents',
  'surveys',
  'survey_questions',
  'survey_targets',
  'survey_responses',
  'survey_answers',
];

describe('EvaluationsAndPerformance1790900000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new EvaluationsAndPerformance1790900000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  // Queries go through `queryRunner` so they see the open transaction.
  async function existingTables(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await queryRunner.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function ratingColumnExists(): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_notes' AND column_name = 'rating'`,
    );
    return rows.length === 1;
  }

  // Every column of the 10 tables, so the test can prove later migrations' columns survive.
  async function columns(): Promise<string[]> {
    const rows: Array<{ c: string }> = await queryRunner.query(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1`,
      [TABLES],
    );
    return rows.map((r) => r.c);
  }

  it('is up after global migrations run: all 10 tables and student_notes.rating exist', async () => {
    expect(await existingTables()).toEqual([...TABLES].sort());
    expect(await ratingColumnExists()).toBe(true);
  });

  it('down() drops the 10 tables and student_notes.rating; a second up() restores them', async () => {
    const before = await columns();
    expect(before).toContain('staff_incidents.withdrawn_at');
    await queryRunner.startTransaction();
    try {
      await migration.down(queryRunner);
      expect(await existingTables()).toEqual([]);
      expect(await ratingColumnExists()).toBe(false);

      await migration.up(queryRunner);
      expect(await existingTables()).toEqual([...TABLES].sort());
      expect(await ratingColumnExists()).toBe(true);
    } finally {
      // Always roll back: later migrations' columns come back, and a failed
      // assertion cannot poison later spec files.
      await queryRunner.rollbackTransaction();
    }
    // The next spec file on this worker database sees the schema it started with.
    expect(await columns()).toEqual(before);
  });
});
