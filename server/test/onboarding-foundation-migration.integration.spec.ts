import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { OnboardingFoundation1791400000000 } from '../src/migrations/1791400000000-OnboardingFoundation';

/**
 * [13.1.2] Runs the migration's `down` then `up` against the already-migrated
 * test database, then restores the "up" state for later spec files.
 */
describe('OnboardingFoundation1791400000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new OnboardingFoundation1791400000000();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function tableExists(name: string): Promise<boolean> {
    const rows = await dataSource.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
    return rows[0].t !== null;
  }

  it('down() removes the table and columns, up() restores them', async () => {
    await migration.down(queryRunner);
    expect(await tableExists('user_identities')).toBe(false);
    const cols = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'schools' AND column_name IN ('country_code','trial_ends_at','seat_limit','onboarding')`,
    );
    expect(cols).toEqual([]);

    await migration.up(queryRunner);
    expect(await tableExists('user_identities')).toBe(true);
  });

  it('backfills existing schools as onboarded, with unlimited seats and no trial (D36)', async () => {
    const [school] = await dataSource.query(
      `SELECT onboarding, seat_limit, trial_ends_at FROM schools WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    expect(school.onboarding.finished_at).toBeTruthy();
    expect(school.seat_limit).toBeNull();
    expect(school.trial_ends_at).toBeNull();
  });

  it('rejects a negative seat_limit', async () => {
    await expect(
      dataSource.query(`UPDATE schools SET seat_limit = -1 WHERE id = $1`, [SEED_TENANT_ID]),
    ).rejects.toThrow();
  });

  it('a soft-deleted UserTenant is not returned by find()', async () => {
    const repo = dataSource.getRepository(UserTenant);
    const row = await repo.save(
      repo.create({
        user_id: SEED_ADMIN_USER_ID,
        tenant_id: SEED_TENANT_ID,
        role: UserRole.COMMITTEE,
      }),
    );
    try {
      await repo.softDelete(row.id);
      expect(await repo.find({ where: { id: row.id } })).toEqual([]);
      expect(await repo.find({ where: { id: row.id }, withDeleted: true })).toHaveLength(1);
    } finally {
      await repo.delete(row.id);
    }
  });
});
