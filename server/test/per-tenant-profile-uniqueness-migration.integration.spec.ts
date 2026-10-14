import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID } from '@test/constants';
import { withMigrationsReverted } from '@test/helpers/db.helper';
import { PerTenantProfileUniqueness1791900000000 } from '../src/migrations/1791900000000-PerTenantProfileUniqueness';

/**
 * [58.0.01] The same user may hold one Teacher / Guardian / Student /
 * StaffProfile row per tenant (D10/D11), and teachers.employee_id is unique
 * per tenant. Runs on the migrated test DB; round-trips the migration.
 */
describe('PerTenantProfileUniqueness migration (integration)', () => {
  let ds: DataSource;
  const migration = new PerTenantProfileUniqueness1791900000000();
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  let roll = 1000;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    if (userIds.length) await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    if (schoolIds.length) await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]);
    await ds.destroy();
  });

  const mkSchool = async () => {
    const id = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      id,
      `S ${id}`,
      `s-${id}`,
    ]);
    schoolIds.push(id);
    return id;
  };
  const mkUser = async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'U')`,
      [id, `u-${id}@example.com`],
    );
    userIds.push(id);
    return id;
  };

  const insert = {
    // teachers.staff_profile_id is NOT NULL, so each teacher row gets its own staff profile.
    teacher: async (tenant: string, user: string, emp: string) => {
      const [sp] = await ds.query(
        `INSERT INTO staff_profiles (user_id, employee_id, tenant_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [user, `E-${randomUUID()}`, tenant],
      );
      const spId =
        sp?.id ??
        (
          await ds.query(`SELECT id FROM staff_profiles WHERE user_id = $1 AND tenant_id = $2`, [
            user,
            tenant,
          ])
        )[0].id;
      return ds.query(
        `INSERT INTO teachers (user_id, employee_id, tenant_id, staff_profile_id) VALUES ($1, $2, $3, $4)`,
        [user, emp, tenant, spId],
      );
    },
    guardian: (tenant: string, user: string) =>
      ds.query(
        `INSERT INTO guardians (user_id, full_name, relationship, tenant_id) VALUES ($1, 'G', 'FATHER', $2)`,
        [user, tenant],
      ),
    student: (tenant: string, user: string) =>
      ds.query(
        `INSERT INTO students (user_id, full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ($1, 'S', $2, $3, $4, $5)`,
        [user, `R-${randomUUID()}`, roll++, SEED_SECTION_1_ID, tenant],
      ),
    staff: (tenant: string, user: string) =>
      ds.query(`INSERT INTO staff_profiles (user_id, employee_id, tenant_id) VALUES ($1, $2, $3)`, [
        user,
        `E-${randomUUID()}`,
        tenant,
      ]),
  };

  it.each(['guardian', 'student', 'staff'] as const)(
    '%s: one per tenant for a user, a second in the same tenant fails with 23505',
    async (kind) => {
      const [a, b, user] = [await mkSchool(), await mkSchool(), await mkUser()];
      await insert[kind](a, user);
      await insert[kind](b, user);
      await expect(insert[kind](a, user)).rejects.toMatchObject({ code: '23505' });
    },
  );

  it('teacher: one per tenant for a user; T-001 allowed in two tenants; same-tenant repeats fail', async () => {
    const [a, b, u1, u2] = [await mkSchool(), await mkSchool(), await mkUser(), await mkUser()];
    const emp = `T-${randomUUID()}`;
    await insert.teacher(a, u1, emp);
    await insert.teacher(b, u1, emp); // same user, same employee_id, other tenant
    await expect(insert.teacher(a, u1, `T-${randomUUID()}`)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(insert.teacher(a, u2, emp)).rejects.toMatchObject({ code: '23505' });
  });

  it('down refuses on a cross-tenant duplicate, then round-trips once cleaned', async () => {
    const [a, b, user] = [await mkSchool(), await mkSchool(), await mkUser()];
    await insert.staff(a, user);
    await insert.staff(b, user);

    const qr = ds.createQueryRunner();
    try {
      await expect(migration.down(qr)).rejects.toThrow(/more than one row/);
    } finally {
      await qr.release();
    }

    // Remove every cross-tenant duplicate other tests left, then revert and re-apply.
    for (const t of ['teachers', 'guardians', 'students', 'staff_profiles']) {
      await ds.query(
        `DELETE FROM ${t} p USING ${t} q WHERE p.user_id = q.user_id AND p.tenant_id <> q.tenant_id AND p.id > q.id`,
      );
    }
    await ds.query(
      `DELETE FROM teachers p USING teachers q WHERE p.employee_id = q.employee_id AND p.id > q.id`,
    );
    await withMigrationsReverted(ds, [migration], async () => {
      // Global key is back: the same user cannot have a second staff profile anywhere.
      const [c, d, u2] = [await mkSchool(), await mkSchool(), await mkUser()];
      await insert.staff(c, u2);
      await expect(insert.staff(d, u2)).rejects.toMatchObject({ code: '23505' });
    });
    // After up() again: per-tenant works.
    const [e, f, u3] = [await mkSchool(), await mkSchool(), await mkUser()];
    await insert.staff(e, u3);
    await insert.staff(f, u3);
  });
});
