import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { EvaluationsAndPerformance1790900000000 } from '../src/migrations/1790900000000-EvaluationsAndPerformance';

/**
 * [28.1.2 / #1227] `down()` of the Epic 28.0 schema migration, which no other
 * spec exercised. Runs against the test database (already migrated once by
 * `server/test/global-setup.ts`); `down()` then `up()` run inside the same
 * test, because the per-test cleanup in `test/setup.ts` deletes from every
 * table in `reset-order.ts` — a test that ended with these tables dropped
 * would break the next test's setup.
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

  async function existingTables(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function ratingColumnExists(): Promise<boolean> {
    const rows = await dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_notes' AND column_name = 'rating'`,
    );
    return rows.length === 1;
  }

  it('is up after global migrations run: all 10 tables and student_notes.rating exist', async () => {
    expect(await existingTables()).toEqual([...TABLES].sort());
    expect(await ratingColumnExists()).toBe(true);
  });

  it('down() drops the 10 tables and student_notes.rating; a second up() restores them', async () => {
    try {
      await migration.down(queryRunner);
      expect(await existingTables()).toEqual([]);
      expect(await ratingColumnExists()).toBe(false);
    } finally {
      // Always restore, so a failed assertion cannot poison later spec files.
      const missing = (await existingTables()).length === 0;
      if (missing) await migration.up(queryRunner);
    }
    expect(await existingTables()).toEqual([...TABLES].sort());
    expect(await ratingColumnExists()).toBe(true);
  });
});
