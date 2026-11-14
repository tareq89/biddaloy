import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { DowngradeTenantLocalSuperAdmin1792500000000 } from '../src/migrations/1792500000000-DowngradeTenantLocalSuperAdmin';

/**
 * [#1313] Runs the migration's raw SQL against the real migrated schema (the global run already
 * applied it once to an empty table), on rows this spec builds.
 */
describe('DowngradeTenantLocalSuperAdmin1792500000000 (integration)', () => {
  let ds: DataSource;
  const migration = new DowngradeTenantLocalSuperAdmin1792500000000();
  const platformId = randomUUID();
  const schoolId = randomUUID();
  let hadPlatform = false;

  async function member(userId: string, tenantId: string, role: string, deleted = false) {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO user_tenants (id, user_id, tenant_id, role, deleted_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, userId, tenantId, role, deleted ? new Date() : null],
    );
    return id;
  }
  const row = async (id: string) =>
    (await ds.query(`SELECT role, deleted_at FROM user_tenants WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    hadPlatform = (await ds.query(`SELECT 1 FROM schools WHERE is_platform = true`)).length > 0;
  });

  // `audit_logs` is write-only, so the schools this spec audits are left for the throwaway test DB.
  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1,'School','mig-1313-s')`, [
      schoolId,
    ]);
    // The platform school exists only for this spec unless the test database already has one.
    if (!hadPlatform) {
      await ds.query(
        `INSERT INTO schools (id, name, slug, is_platform) VALUES ($1,'Platform','mig-1313-p',true)`,
        [platformId],
      );
    }
  });

  async function mkUser() {
    const id = randomUUID();
    await ds.query(`INSERT INTO users (id, email, full_name) VALUES ($1,$2,'U')`, [
      id,
      `${id}@mig-1313.test`,
    ]);
    return id;
  }

  it('downgrades a school SUPER_ADMIN to ADMIN, soft-deletes one who already is ADMIN, leaves the platform school alone, and down() restores', async () => {
    const platformSchool = hadPlatform
      ? (await ds.query(`SELECT id FROM schools WHERE is_platform = true`))[0].id
      : platformId;
    const lone = await member(await mkUser(), schoolId, 'SUPER_ADMIN');
    const both = await mkUser();
    const bothSuper = await member(both, schoolId, 'SUPER_ADMIN');
    const bothAdmin = await member(both, schoolId, 'ADMIN');
    const owner = await member(await mkUser(), platformSchool, 'SUPER_ADMIN');

    await migration.up(ds.createQueryRunner());

    expect((await row(lone)).role).toBe('ADMIN');
    expect((await row(bothSuper)).deleted_at).not.toBeNull();
    expect((await row(bothAdmin)).role).toBe('ADMIN');
    expect((await row(owner)).role).toBe('SUPER_ADMIN');
    const audits = await ds.query(
      `SELECT new_values->>'outcome' AS outcome FROM audit_logs
        WHERE tenant_id = $1 AND new_values->>'event' = 'LEGACY_SUPER_ADMIN_DOWNGRADE'`,
      [schoolId],
    );
    expect(audits.map((a: { outcome: string }) => a.outcome).sort()).toEqual([
      'downgraded',
      'removed',
    ]);

    // Idempotent: a second run changes nothing.
    await migration.up(ds.createQueryRunner());
    expect(
      await ds.query(
        `SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND new_values->>'event' = 'LEGACY_SUPER_ADMIN_DOWNGRADE'`,
        [schoolId],
      ),
    ).toHaveLength(2);

    await migration.down(ds.createQueryRunner());
    expect((await row(lone)).role).toBe('SUPER_ADMIN');
    expect((await row(bothSuper)).deleted_at).toBeNull();
  });
});
