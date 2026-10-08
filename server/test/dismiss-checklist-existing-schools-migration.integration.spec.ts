import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { DismissChecklistForExistingSchools1791400000100 } from '../src/migrations/1791400000100-DismissChecklistForExistingSchools';

/**
 * #1706 F4. Builds its own school rows (one per onboarding shape) and runs the
 * migration against them. `up()` is idempotent and `down()` only undoes its own
 * stamp, so the suite always ends with `up()` applied, as the worker DB expects.
 */
describe('DismissChecklistForExistingSchools1791400000100 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new DismissChecklistForExistingSchools1791400000100();
  const ids: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    if (ids.length) await dataSource.query(`DELETE FROM schools WHERE id = ANY($1)`, [ids]);
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function school(onboarding: object | null): Promise<string> {
    const [row] = await dataSource.query(
      `INSERT INTO schools (id, name, slug, onboarding) VALUES (gen_random_uuid(), 'Checklist Migration', $1, $2::jsonb) RETURNING id`,
      [`checklist-migration-${Date.now()}-${ids.length}`, onboarding && JSON.stringify(onboarding)],
    );
    ids.push(row.id);
    return row.id;
  }

  async function onboardingOf(id: string): Promise<Record<string, unknown> | null> {
    const [row] = await dataSource.query(`SELECT onboarding FROM schools WHERE id = $1`, [id]);
    return row.onboarding;
  }

  it('dismisses the checklist only for schools the foundation backfill marked finished', async () => {
    const FINISHED = '2026-10-01T00:00:00.000Z';
    // Exactly what OnboardingFoundation's backfill writes for an existing school.
    const existing = await school({ finished_at: FINISHED });
    // A school that went through the wizard: it also wrote seen_by and setup_path.
    const wizard = await school({
      finished_at: FINISHED,
      seen_by: ['u1'],
      setup_path: 'guided',
    });
    // A brand-new school: no onboarding yet, or mid-wizard.
    const fresh = await school(null);
    const midway = await school({ seen_by: ['u1'], setup_path: 'excel' });

    await migration.up(queryRunner);

    expect(await onboardingOf(existing)).toEqual({ finished_at: FINISHED, dismissed_at: FINISHED });
    expect(await onboardingOf(wizard)).toEqual({
      finished_at: FINISHED,
      seen_by: ['u1'],
      setup_path: 'guided',
    });
    expect(await onboardingOf(fresh)).toBeNull();
    expect(await onboardingOf(midway)).toEqual({ seen_by: ['u1'], setup_path: 'excel' });

    // Running it twice changes nothing.
    await migration.up(queryRunner);
    expect(await onboardingOf(existing)).toEqual({ finished_at: FINISHED, dismissed_at: FINISHED });
  });

  it('down() removes only its own stamp, never a dismissal a person made', async () => {
    const FINISHED = '2026-10-01T00:00:00.000Z';
    const existing = await school({ finished_at: FINISHED });
    const dismissedByHand = await school({
      finished_at: FINISHED,
      dismissed_at: '2026-10-05T09:00:00.000Z',
    });
    await migration.up(queryRunner);

    try {
      await migration.down(queryRunner);
      expect(await onboardingOf(existing)).toEqual({ finished_at: FINISHED });
      expect(await onboardingOf(dismissedByHand)).toEqual({
        finished_at: FINISHED,
        dismissed_at: '2026-10-05T09:00:00.000Z',
      });
    } finally {
      // Leave the worker DB in its migrated state for later spec files.
      await migration.up(queryRunner);
    }
    expect(await onboardingOf(existing)).toEqual({ finished_at: FINISHED, dismissed_at: FINISHED });
  });
});
