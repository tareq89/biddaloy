import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { NOT_GIVEN_BN } from './dto/student-count.dto';
import { StudentCountService } from './student-count.service';

/**
 * [8.15.53] The BANBEIS head count against the real database. Business rules proved here: the
 * total equals the number of active enrolments, a student with no recorded religion is counted
 * under "not given", another school never leaks in, and COMMITTEE sees no cell under 5 while the
 * total stays true (D14).
 */
describe('StudentCountService (integration)', () => {
  let ds: DataSource;
  let service: StudentCountService;
  let tenantA: string;
  let tenantB: string;
  let yearA: string;

  const q = async <T = { id: string }>(sql: string, params: unknown[]): Promise<T[]> =>
    ds.query(sql, params);

  async function school(): Promise<string> {
    const [r] = await q(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Count ${randomUUID()}`,
      `count-${randomUUID()}`,
    ]);
    return r.id;
  }

  async function year(tenantId: string, name: string, current: boolean): Promise<string> {
    const [r] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ($1, '2026-01-01', '2026-12-31', $2, $3) RETURNING id`,
      [name, current, tenantId],
    );
    return r.id;
  }

  async function klass(tenantId: string, yearId: string, name: string, grade: number) {
    const [c] = await q(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, grade, yearId, tenantId],
    );
    const [s] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, tenantId],
    );
    return { classId: c.id, sectionId: s.id };
  }

  /** Adds `n` students to a class, each with an enrolment in `status`. */
  async function students(
    tenantId: string,
    yearId: string,
    c: { classId: string; sectionId: string },
    n: number,
    gender: string | null,
    religion: string | null,
    status = 'ACTIVE',
  ) {
    for (let i = 0; i < n; i++) {
      const [s] = await q(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, gender, religion, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          `S ${randomUUID()}`,
          `R-${randomUUID()}`,
          Math.floor(Math.random() * 1e6),
          c.sectionId,
          gender,
          religion,
          tenantId,
        ],
      );
      await q(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.id, c.classId, c.sectionId, yearId, status, tenantId],
      );
    }
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [StudentCountService]);
    ds = module.get(DataSource);
    service = module.get(StudentCountService);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantA = await school();
    tenantB = await school();
    yearA = await year(tenantA, '2026', true);
    const six = await klass(tenantA, yearA, 'Six', 6);
    const seven = await klass(tenantA, yearA, 'Seven', 7);

    await students(tenantA, yearA, six, 12, 'MALE', 'ISLAM');
    await students(tenantA, yearA, six, 9, 'FEMALE', 'ISLAM');
    await students(tenantA, yearA, six, 3, 'FEMALE', 'HINDU'); // under 5: hidden for COMMITTEE
    await students(tenantA, yearA, six, 6, 'MALE', null); // religion never recorded
    await students(tenantA, yearA, seven, 7, 'MALE', 'ISLAM');
    await students(tenantA, yearA, seven, 4, 'MALE', 'ISLAM', 'TRANSFERRED'); // not active: not counted

    // Another school with its own students, which must never show up.
    const yearB = await year(tenantB, '2026', true);
    const sixB = await klass(tenantB, yearB, 'Six', 6);
    await students(tenantB, yearB, sixB, 50, 'MALE', 'ISLAM');
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('the total equals the number of active enrolments in the year', async () => {
    const data = await service.getCount(tenantA, UserRole.ADMIN);
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM enrollments
        WHERE tenant_id = $1 AND academic_year_id = $2 AND enrollment_status = 'ACTIVE'`,
      [tenantA, yearA],
    );
    expect(data.totals.students).toBe(Number(n));
    expect(data.totals.students).toBe(12 + 9 + 3 + 6 + 7);
    expect(data.rows.reduce((sum, r) => sum + (r.count ?? 0), 0)).toBe(Number(n));
    expect(data.academic_year_name).toBe('2026');
  });

  it('splits by class, gender and religion in class order', async () => {
    const data = await service.getCount(tenantA, UserRole.ADMIN);
    expect(data.rows.map((r) => [r.class_name, r.gender, r.religion, r.count])).toEqual([
      ['Six', 'FEMALE', 'HINDU', 3],
      ['Six', 'FEMALE', 'ISLAM', 9],
      ['Six', 'MALE', 'ISLAM', 12],
      ['Six', 'MALE', NOT_GIVEN_BN, 6],
      ['Seven', 'MALE', 'ISLAM', 7],
    ]);
  });

  it('counts a student with no religion under "not given", not under a guess', async () => {
    const data = await service.getCount(tenantA, UserRole.ADMIN);
    const notGiven = data.rows.filter((r) => r.religion === NOT_GIVEN_BN);
    expect(notGiven.map((r) => r.count)).toEqual([6]);
  });

  it('never includes another school', async () => {
    const data = await service.getCount(tenantA, UserRole.ADMIN);
    expect(data.totals.students).toBeLessThan(50); // school B alone has 50 in class Six
    const other = await service.getCount(tenantB, UserRole.ADMIN);
    expect(other.totals.students).toBe(50);
  });

  it("refuses another school's academic year", async () => {
    await expect(service.getCount(tenantB, UserRole.ADMIN, yearA)).rejects.toThrow(
      'Academic year not found',
    );
  });

  it('with no current year returns an empty count', async () => {
    const empty = await school();
    const data = await service.getCount(empty, UserRole.ADMIN);
    expect(data).toMatchObject({ academic_year_id: null, rows: [], totals: { students: 0 } });
  });

  it('hides every cell under 5 from COMMITTEE but keeps the true total', async () => {
    const data = await service.getCount(tenantA, UserRole.COMMITTEE);
    const hindu = data.rows.find((r) => r.religion === 'HINDU');
    expect(hindu).toMatchObject({ count: null, suppressed: true });
    expect(data.rows.find((r) => r.count === 9)?.suppressed).toBe(false);
    // The total is the real 37, not the sum of the visible cells (34).
    expect(data.totals.students).toBe(37);
  });

  it('staff are counted by type from their open designation', async () => {
    const [teacher] = await q(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'T', 'x') RETURNING id`,
      [`t-${randomUUID()}@example.test`],
    );
    const [clerk] = await q(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'C', 'x') RETURNING id`,
      [`c-${randomUUID()}@example.test`],
    );
    const [unassigned] = await q(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'U', 'x') RETURNING id`,
      [`u-${randomUUID()}@example.test`],
    );
    const [teaching] = await q(
      `INSERT INTO designations (tenant_id, title_en, title_bn, is_teaching) VALUES ($1, 'Teacher', 'শিক্ষক', true) RETURNING id`,
      [tenantA],
    );
    const [office] = await q(
      `INSERT INTO designations (tenant_id, title_en, title_bn, is_teaching) VALUES ($1, 'Clerk', 'করণিক', false) RETURNING id`,
      [tenantA],
    );
    for (const [user, designation] of [
      [teacher.id, teaching.id],
      [clerk.id, office.id],
      [unassigned.id, null],
    ]) {
      await q(`INSERT INTO staff_profiles (user_id, tenant_id, employee_id) VALUES ($1, $2, $3)`, [
        user,
        tenantA,
        `E-${randomUUID()}`,
      ]);
      if (designation) {
        await q(
          `INSERT INTO staff_designation_history (tenant_id, user_id, designation_id, effective_date, status)
           VALUES ($1, $2, $3, '2026-01-01', 'REGULAR')`,
          [tenantA, user, designation],
        );
      }
    }

    const data = await service.getCount(tenantA, UserRole.ADMIN);
    const byType = Object.fromEntries(data.staff.rows.map((r) => [r.staff_type, r.count]));
    expect(byType).toMatchObject({ TEACHING: 1, NON_TEACHING: 1, UNASSIGNED: 1 });
    expect(data.staff.total).toBe(3);
    // Each of these is under 5, so COMMITTEE sees "—" for the cells but the true total.
    const committee = await service.getCount(tenantA, UserRole.COMMITTEE);
    expect(committee.staff.rows.every((r) => r.count === null)).toBe(true);
    expect(committee.staff.total).toBe(3);
  });

  it('exports the student table with Bangla headings and an empty cell for a hidden count', async () => {
    const admin = await service.exportRows(tenantA, UserRole.ADMIN, 'students');
    expect(admin.header).toEqual(['শ্রেণি', 'লিঙ্গ', 'ধর্ম', 'শিক্ষার্থী']);
    expect(admin.rows[0]).toEqual(['Six', 'FEMALE', 'HINDU', 3]);
    const committee = await service.exportRows(tenantA, UserRole.COMMITTEE, 'students');
    expect(committee.rows[0]).toEqual(['Six', 'FEMALE', 'HINDU', '']);
  });
});
