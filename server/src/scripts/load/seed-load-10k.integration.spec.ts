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
      ).toBe(Object.keys(LOAD_LOGINS).length + 40); // + 40 staff (30 teachers, 10 office)
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

    // --- seeds what the other widgets read (small-run row counts for 100 students)
    {
      const n = (table: string, where = '') =>
        count(`SELECT count(*)::int c FROM ${table} WHERE tenant_id = $1 ${where}`, [tenantId]);
      expect(await n('exams')).toBe(20); // 10 classes x (published term + draft monthly)
      expect(await n('exams', `AND status = 'PUBLISHED'`)).toBe(10);
      // every student has one published result; marks = 100 students x 8 subjects
      expect(await n('results')).toBe(100);
      expect(await n('marks', `AND value >= 30`)).toBeGreaterThanOrEqual(800);
      expect(await n('homework')).toBe(80);
      expect(await n('syllabus_topics')).toBe(800);
      expect(await n('staff_profiles')).toBe(41);
      // 41 staff x 60 working days
      expect(await n('staff_attendance_records')).toBe(41 * 60);
      expect(await n('communication_logs')).toBe(300);
      expect(await n('communication_logs', `AND status = 'FAILED'`)).toBeGreaterThanOrEqual(1);
      expect(await n('admission_applicants')).toBe(600);
      expect(await n('seat_plans')).toBe(2);
      expect(await n('seat_allocations')).toBeGreaterThan(0);
      expect(await n('leave_records')).toBe(41 * 3);
      expect(await n('routines')).toBe(1);
      // 50 sections x 6 periods x 6 weekdays
      expect(await n('routine_slots')).toBe(1800);
      // the login teacher is class teacher of section 1 and teaches sections 1-10
      expect(
        await count(
          `SELECT count(*)::int c FROM teacher_class_sections tcs
             JOIN teachers t ON t.id = tcs.teacher_id JOIN users u ON u.id = t.user_id
            WHERE tcs.tenant_id = $1 AND u.email = 'load-teacher@biddaloy.test'`,
          [tenantId],
        ),
      ).toBeGreaterThanOrEqual(11);
      // last year's bills exist for the same month a year ago
      expect(
        await count(
          `SELECT count(*)::int c FROM student_fees sf JOIN students s ON s.id = sf.student_id
            WHERE s.tenant_id = $1
              AND sf.period_start = (date_trunc('month', now()) - interval '1 year')::date`,
          [tenantId],
        ),
      ).toBeGreaterThanOrEqual(100);
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
