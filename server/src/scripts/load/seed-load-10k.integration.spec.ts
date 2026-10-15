import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { LOAD_LOGINS, LOAD_TENANT_SLUG, seedLoadSchool } from './seed-load-10k';

// Runs the seed with 100 students (the SCALE=0.01 size) on the test worker's own database.
// The guard is not under test here (see load-seed-guard.spec.ts): the test DB name is
// deliberately not a "throwaway" name, so this spec calls seedLoadSchool directly.
describe('seedLoadSchool (integration, 100 students)', () => {
  let ds: DataSource;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const count = async (sql: string, params: unknown[] = []): Promise<number> =>
    (await q(sql, params))[0].c;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 120000);

  // The test setup empties most tables between tests but keeps `schools`, and a second seed
  // would (correctly) refuse - so the whole story runs as one test on one seeded school.
  it('seeds one school with the expected volume, then refuses to run again', async () => {
    const otherStudentsBefore = await count(`SELECT count(*)::int c FROM students`);
    const r = await seedLoadSchool(ds, { students: 100, password: 'load-test-pass1' });
    if (r.status !== 'seeded') throw new Error('expected a first run to seed');
    const tenantId = r.tenantId;
    // --- creates the tenant with 100 students and one login per role
    {
      expect(
        await count(`SELECT count(*)::int c FROM schools WHERE slug = $1`, [LOAD_TENANT_SLUG]),
      ).toBe(1);
      expect(
        await count(`SELECT count(*)::int c FROM students WHERE tenant_id = $1`, [tenantId]),
      ).toBe(100);
      expect(
        await count(`SELECT count(*)::int c FROM user_tenants WHERE tenant_id = $1`, [tenantId]),
      ).toBe(Object.keys(LOAD_LOGINS).length);
    }

    // --- writes a register for each of 60 working days, none on a Friday
    {
      expect(
        await count(
          `SELECT count(DISTINCT date)::int c FROM attendance_sessions WHERE tenant_id = $1`,
          [tenantId],
        ),
      ).toBe(60);
      expect(
        await count(
          `SELECT count(*)::int c FROM attendance_sessions WHERE tenant_id = $1 AND extract(dow FROM date) = 5`,
          [tenantId],
        ),
      ).toBe(0);
      // 100 students x 60 days
      expect(
        await count(`SELECT count(*)::int c FROM attendance_records WHERE tenant_id = $1`, [
          tenantId,
        ]),
      ).toBe(6000);
    }

    // --- has PAID and PENDING bills, and a payment for every paid bill
    {
      const byStatus = (s: string) =>
        count(
          `SELECT count(*)::int c FROM student_fees sf JOIN students s ON s.id = sf.student_id
          WHERE s.tenant_id = $1 AND sf.status = $2`,
          [tenantId, s],
        );
      expect(await byStatus('PAID')).toBeGreaterThanOrEqual(1);
      expect(await byStatus('PENDING')).toBeGreaterThanOrEqual(1);
      expect(
        await count(
          `SELECT count(*)::int c FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.tenant_id = $1`,
          [tenantId],
        ),
      ).toBe(await count(`SELECT count(*)::int c FROM payments WHERE tenant_id = $1`, [tenantId]));
    }

    // --- puts every tenant-scoped row under the new tenant (no orphan tenant ids)
    {
      // Students of the load school are enrolled only in the load school's classes.
      expect(
        await count(
          `SELECT count(*)::int c FROM enrollments e JOIN classes c ON c.id = e.class_id
          WHERE e.tenant_id = $1 AND c.tenant_id <> $1`,
          [tenantId],
        ),
      ).toBe(0);
    }

    // --- refuses to top up: a second run adds nothing, and other schools are untouched
    {
      const before = await count(`SELECT count(*)::int c FROM students`);
      const again = await seedLoadSchool(ds, { students: 100, password: 'load-test-pass1' });
      expect(again.status).toBe('already-seeded');
      expect(await count(`SELECT count(*)::int c FROM students`)).toBe(before);
      expect(before - 100).toBe(otherStudentsBefore);
    }
  }, 120000);
});
