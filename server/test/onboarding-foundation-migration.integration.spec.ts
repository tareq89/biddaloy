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
 * test database; the round trip always ends with the schema back in its "up"
 * state so later spec files on the same worker DB are unaffected.
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

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows.length > 0;
  }

  async function createUser(email: string): Promise<string> {
    const [user] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Identity Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [email],
    );
    return user.id;
  }

  function insertIdentity(userId: string, provider: string, subject: string) {
    return dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, $2, $3)`,
      [userId, provider, subject],
    );
  }

  it('down() removes the table and columns and drops removed members, up() restores them', async () => {
    const [removed] = await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at, created_at, updated_at)
       VALUES ($1, $2, 'COMMITTEE', NOW(), NOW(), NOW()) RETURNING id`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID],
    );
    try {
      await migration.down(queryRunner);
      expect(await tableExists('user_identities')).toBe(false);
      const cols = await dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'schools' AND column_name IN ('country_code','trial_ends_at','seat_limit','onboarding')`,
      );
      expect(cols).toEqual([]);
      expect(await columnExists('user_tenants', 'deleted_at')).toBe(false);
      // A removed member must stay removed, not come back as a live row.
      expect(
        await dataSource.query(`SELECT id FROM user_tenants WHERE id = $1`, [removed.id]),
      ).toEqual([]);

      await migration.up(queryRunner);
      expect(await tableExists('user_identities')).toBe(true);
      expect(await columnExists('user_tenants', 'deleted_at')).toBe(true);
    } finally {
      // Never leave the shared worker DB half-migrated for later spec files.
      if (!(await tableExists('user_identities'))) await migration.up(queryRunner);
      await dataSource.query(`DELETE FROM user_tenants WHERE id = $1`, [removed.id]);
    }
  });

  it('rejects a duplicate (provider, subject) and a duplicate (user_id, provider)', async () => {
    const userId = await createUser('identity-dup@test.local');
    try {
      await insertIdentity(userId, 'google', 'sub-1');
      await expect(insertIdentity(SEED_ADMIN_USER_ID, 'google', 'sub-1')).rejects.toThrow();
      await expect(insertIdentity(userId, 'google', 'sub-2')).rejects.toThrow();
    } finally {
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  it('deleting a user deletes its identities', async () => {
    const userId = await createUser('identity-cascade@test.local');
    await insertIdentity(userId, 'google', 'sub-cascade');
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    expect(
      await dataSource.query(`SELECT id FROM user_identities WHERE user_id = $1`, [userId]),
    ).toEqual([]);
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
