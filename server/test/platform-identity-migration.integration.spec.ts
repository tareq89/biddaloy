import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { User } from '../src/modules/users/entities/user.entity';

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
    const module = await createTestModule([School, User], []);
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
    const make = (slug: string) =>
      ds.query(`INSERT INTO "schools" (id, name, slug, is_platform) VALUES ($1, 'P', $2, true)`, [
        randomUUID(),
        slug,
      ]);
    // Other specs may have made one already; clear it so the first insert is ours.
    await ds.query(`UPDATE "schools" SET is_platform = false WHERE is_platform`);
    const slugA = `plat-a-${randomUUID().slice(0, 8)}`;
    await make(slugA);
    createdSchools.push(
      (await ds.query(`SELECT id FROM "schools" WHERE slug = $1`, [slugA]))[0].id,
    );
    await expect(make(`plat-b-${randomUUID().slice(0, 8)}`)).rejects.toMatchObject({
      code: '23505',
    });
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
      code: '23503',
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
});
