import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { AddSchoolLifecycleStatus1789000000000 } from '../src/migrations/1789000000000-AddSchoolLifecycleStatus';

/**
 * [15.4] Runs the `schools` lifecycle-status migration's `up`/`down`
 * directly against the test database (already migrated once by
 * `server/test/global-setup.ts`, which includes this migration). We drop
 * the columns and re-add them here to prove both directions actually
 * work, then restore `up` state so later spec files in the same run see
 * the columns they expect.
 */
describe('AddSchoolLifecycleStatus1789000000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AddSchoolLifecycleStatus1789000000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    // Leave the schema in the "up" state for any other spec file that runs
    // after this one in the same `vitest run` invocation.
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function columnNames(): Promise<string[]> {
    const rows: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'schools' AND column_name IN ('status', 'status_reason', 'status_changed_at')`,
    );
    return rows.map((r) => r.column_name).sort();
  }

  it('is up after global migrations run: status/status_reason/status_changed_at exist', async () => {
    expect(await columnNames()).toEqual(['status', 'status_changed_at', 'status_reason']);
  });

  it('down() drops all three columns', async () => {
    await migration.down(queryRunner);
    expect(await columnNames()).toEqual([]);
  });

  it('up() re-adds the columns with the ACTIVE default and check constraint', async () => {
    await migration.up(queryRunner);
    expect(await columnNames()).toEqual(['status', 'status_changed_at', 'status_reason']);

    const [{ column_default }] = await dataSource.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'status'`,
    );
    expect(column_default).toContain('ACTIVE');

    // The check constraint rejects any value outside ACTIVE/SUSPENDED.
    await expect(
      dataSource.query(
        `INSERT INTO "schools" (id, name, slug, status) VALUES (gen_random_uuid(), 'x', 'x-check-slug', 'BOGUS')`,
      ),
    ).rejects.toThrow();
  });
});
