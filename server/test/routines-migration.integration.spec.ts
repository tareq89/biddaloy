import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { AddRoutines1789800011000 } from '../src/migrations/1789800011000-AddRoutines';

/**
 * [21.2.1] Runs the routines migration's `up`/`down` directly against the
 * test database (already migrated once by `global-setup.ts`, which
 * includes this migration).
 *
 * Unlike `school-lifecycle-status-migration.integration.spec.ts` (which
 * only drops/re-adds columns), this migration drops eight whole tables.
 * `test/setup.ts`'s global `beforeEach` resets those same eight tables
 * (via a *different* connection, opened in `test/setup.ts`) before every
 * test in the run — if one were left dropped when that hook fires, it
 * would break every later test in this worker, not just this file. So
 * `down()` and `up()` run inside one `it()` block rather than split
 * across two, the way the schools migration test does it.
 */
describe('AddRoutines1789800011000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new AddRoutines1789800011000();

  const TABLES = [
    'shifts',
    'period_slots',
    'rooms',
    'routines',
    'routine_slots',
    'routine_slot_teachers',
    'routine_substitutions',
    'routine_change_requests',
  ].sort();

  beforeAll(async () => {
    const module = await createTestModule([School, AcademicYear, Class, ClassSection, Shift], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    // Leave the schema in the "up" state for any other spec file that runs
    // after this one in the same `vitest run` invocation.
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function existingRoutineTables(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    return rows.map((r) => r.table_name).sort();
  }

  async function classesShiftIdExists(): Promise<boolean> {
    const rows = await dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'classes' AND column_name = 'shift_id'`,
    );
    return rows.length > 0;
  }

  it('is up after global migrations run: all eight tables and classes.shift_id exist', async () => {
    expect(await existingRoutineTables()).toEqual(TABLES);
    expect(await classesShiftIdExists()).toBe(true);
  });

  it('down() drops all eight tables and classes.shift_id; up() restores them and re-promotes a real row', async () => {
    // A database with rows, per the ticket's "verify it against a database
    // with rows" acceptance bullet — a real class carrying a `shift`
    // string, the same shape the promotion SQL reads.
    const school = await dataSource
      .getRepository(School)
      .save({ name: 'Migration Test School', slug: `migration-test-school-${Date.now()}` });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: school.id,
    });
    const klass = await dataSource.getRepository(Class).save({
      name: 'Migration Test Class',
      academic_year_id: year.id,
      tenant_id: school.id,
      shift: 'Morning',
    });

    await migration.down(queryRunner);
    // Restore the schema in `finally` — if an assertion below throws, the
    // shared test database must not stay stuck without the routine
    // tables and `classes.shift_id`, which would break every later
    // integration file that runs against this same database.
    try {
      expect(await existingRoutineTables()).toEqual([]);
      expect(await classesShiftIdExists()).toBe(false);
      // `down()` only drops `shift_id` — the free-text `shift` column it
      // was promoted from must survive so `up()` can re-derive it.
      const [{ shift }] = await dataSource.query('SELECT shift FROM classes WHERE id = $1', [
        klass.id,
      ]);
      expect(shift).toBe('Morning');
    } finally {
      await migration.up(queryRunner);
    }

    expect(await existingRoutineTables()).toEqual(TABLES);
    expect(await classesShiftIdExists()).toBe(true);

    const [{ shift_id }] = await dataSource.query('SELECT shift_id FROM classes WHERE id = $1', [
      klass.id,
    ]);
    expect(shift_id).not.toBeNull();
    const [{ name, tenant_id }] = await dataSource.query(
      'SELECT name, tenant_id FROM shifts WHERE id = $1',
      [shift_id],
    );
    expect(name).toBe('Morning');
    expect(tenant_id).toBe(school.id);
  });
});
