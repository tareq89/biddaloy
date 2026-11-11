import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { PlatformIdentity1792000000000 } from '../src/migrations/1792000000000-PlatformIdentity';
import { School } from '../src/modules/schools/entities/school.entity';

/** [Epic 98 / #3734] Platform identity tables, constraints and audit values, on the migrated test DB. */
describe('PlatformIdentity1792000000000 (integration)', () => {
  let ds: DataSource;
  const createdSchools: string[] = [];
  const createdUsers: string[] = [];

  const newUser = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO "users" (id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', 'Test Owner')`,
      [id, `pi-${id.slice(0, 8)}@example.test`],
    );
    createdUsers.push(id);
    return id;
  };

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM "platform_approvals" WHERE requested_by = ANY($1)`, [createdUsers]);
    await ds.query(`DELETE FROM "platform_admins" WHERE user_id = ANY($1)`, [createdUsers]);
    await ds.query(`DELETE FROM "schools" WHERE id = ANY($1)`, [createdSchools]);
    await ds.query(`DELETE FROM "users" WHERE id = ANY($1)`, [createdUsers]);
    await ds.destroy();
  });

  it('creates all six tables', async () => {
    const rows: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name = ANY($1)`,
      [
        [
          'platform_admins',
          'user_mfa',
          'user_recovery_codes',
          'platform_admin_devices',
          'platform_approvals',
          'platform_settings',
        ],
      ],
    );
    expect(rows).toHaveLength(6);
  });

  it('allows only one is_platform school (unique index, 23505)', async () => {
    // Everything runs in one transaction that is rolled back, so the shared test DB keeps
    // whatever platform row (if any) other specs rely on.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`UPDATE "schools" SET is_platform = false WHERE is_platform`);
      const make = (slug: string) =>
        qr.query(`INSERT INTO "schools" (id, name, slug, is_platform) VALUES ($1, 'P', $2, true)`, [
          randomUUID(),
          slug,
        ]);
      await make(`plat-a-${randomUUID().slice(0, 8)}`);
      await expect(make(`plat-b-${randomUUID().slice(0, 8)}`)).rejects.toMatchObject({
        code: '23505',
      });
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });

  it('rejects an unknown approval status (CHECK)', async () => {
    const user = await newUser();
    await expect(
      ds.query(
        `INSERT INTO "platform_approvals" (scope, payload_hash, summary, requested_by, status, expires_at)
         VALUES ('platform.owner_lock', repeat('a', 64), '{}', $1, 'BOGUS', now())`,
        [user],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a recovery code hash that is not 64 chars (CHECK)', async () => {
    const user = await newUser();
    await expect(
      ds.query(`INSERT INTO "user_recovery_codes" (user_id, code_hash) VALUES ($1, 'short')`, [
        user,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("blocks deleting a platform admin's user row (ON DELETE RESTRICT)", async () => {
    const user = await newUser();
    await ds.query(`INSERT INTO "platform_admins" (user_id) VALUES ($1)`, [user]);
    await expect(ds.query(`DELETE FROM "users" WHERE id = $1`, [user])).rejects.toMatchObject({
      code: '23001',
    });
  });

  it('has the 13 new audit action values', async () => {
    const rows: { enumlabel: string }[] = await ds.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.audit_logs_action_enum'::regtype`,
    );
    const labels = rows.map((r) => r.enumlabel);
    const platform = Object.values(AuditAction).filter((a) => a.startsWith('PLATFORM_'));
    expect(platform).toHaveLength(13);
    for (const a of platform) expect(labels).toContain(a);
  });

  // Last on purpose: down() drops the audit values and tables, up() restores them.
  it('down() then up() round-trips: tables, column and audit values come back', async () => {
    const migration = new PlatformIdentity1792000000000();
    const qr = ds.createQueryRunner();
    const count = async (): Promise<number> =>
      (
        await ds.query(
          `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = ANY($1)`,
          [
            [
              'platform_admins',
              'user_mfa',
              'user_recovery_codes',
              'platform_admin_devices',
              'platform_approvals',
              'platform_settings',
            ],
          ],
        )
      )[0].n;
    try {
      await migration.down(qr);
      expect(await count()).toBe(0);
      const gone = await ds.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='schools' AND column_name='is_platform'`,
      );
      expect(gone).toHaveLength(0);
      const labels: { enumlabel: string }[] = await ds.query(
        `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.audit_logs_action_enum'::regtype`,
      );
      expect(labels.some((l) => l.enumlabel.startsWith('PLATFORM_'))).toBe(false);
    } finally {
      // Always restore, or later specs lose the platform tables.
      if ((await count()) === 0) await migration.up(qr);
      await qr.release();
    }
    expect(await count()).toBe(6);
  });
});
