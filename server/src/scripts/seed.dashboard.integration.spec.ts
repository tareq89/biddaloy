import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { SEED_DASHBOARD_EXAM_NAME, SEED_DASHBOARD_GROUP_C } from '../../../e2e/seed-contract';
import {
  DASHBOARD_DUES_FEE_NAME,
  DASHBOARD_EXAM_NAME,
  DASHBOARD_GROUP_C,
  ensureDashboardSeed,
} from './seed.dashboard';

describe('ensureDashboardSeed (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
  let teacherEmail: string;
  let teacherUserId: string;
  let teacherId: string;
  let sectionBId: string;
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  /** One school, current year, 3 sections of one class (1 subject), 3 students each, 3 staff. */
  beforeEach(async () => {
    [{ id: tenantId }] = await q(
      `INSERT INTO schools (name, slug) VALUES ('Dash Seed', $1) RETURNING id`,
      [`dash-seed-${Math.random().toString(36).slice(2, 9)}`],
    );
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('Y', '2020-01-01', '2099-12-31', true, $1) RETURNING id`,
      [tenantId],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('7', $1, $2) RETURNING id`,
      [yearId, tenantId],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', 'M-1') RETURNING id`,
      [tenantId],
    );
    await q(
      `INSERT INTO class_subjects (tenant_id, class_id, subject_id, academic_year_id) VALUES ($1, $2, $3, $4)`,
      [tenantId, classId, subjectId, yearId],
    );
    // Group C: a grading scale for the results, and two more subjects for a 3-sitting exam.
    await q(
      `INSERT INTO grading_scales (id, tenant_id, academic_year_id, name) VALUES (gen_random_uuid(), $1, $2, 'Scale')`,
      [tenantId, yearId],
    );
    for (const [n, name] of ['Science', 'English'].entries()) {
      await q(`INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, $2, $2, $3)`, [
        tenantId,
        name,
        `X-${n}`,
      ]);
    }
    for (const name of ['A', 'B', 'C']) {
      const [{ id: sectionId }] = await q(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
        [classId, name, tenantId],
      );
      for (let n = 1; n <= 3; n += 1) {
        await q(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
          [`S ${name}${n}`, `R-${tenantId.slice(0, 6)}-${name}${n}`, n, sectionId, tenantId],
        );
      }
    }
    for (let n = 1; n <= 3; n += 1) {
      const [{ id: userId }] = await q(
        `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', $2, 'ACTIVE') RETURNING id`,
        [`dash-staff-${n}-${tenantId.slice(0, 8)}@example.test`, `Staff ${n}`],
      );
      await q(
        `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())`,
        [userId, tenantId, `SP-${n}`],
      );
    }

    // The wave-3 teacher: class teacher of A, maths teacher of B, with a published routine to join.
    teacherEmail = `dash-teacher-${tenantId.slice(0, 8)}@example.test`;
    [{ id: teacherUserId }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status) VALUES ($1, 'x', 'Dash Teacher', 'ACTIVE') RETURNING id`,
      [teacherEmail],
    );
    const [{ id: teacherProfileId }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [teacherUserId, tenantId, `SP-T-${tenantId.slice(0, 8)}`],
    );
    [{ id: teacherId }] = await q(
      `INSERT INTO teachers (user_id, staff_profile_id, employee_id, designations, tenant_id)
       VALUES ($1, $2, $3, '{}', $4) RETURNING id`,
      [teacherUserId, teacherProfileId, `T-${tenantId.slice(0, 8)}`, tenantId],
    );
    const [a, b] = await q(
      `SELECT id FROM class_sections WHERE tenant_id = $1 ORDER BY section_name LIMIT 2`,
      [tenantId],
    );
    sectionBId = b.id;
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $4, NULL, 'CLASS_TEACHER'), ($1, $3, $4, $5, 'SUBJECT_TEACHER')`,
      [teacherId, a.id, b.id, tenantId, subjectId],
    );
    const [{ id: shiftId }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, 'Morning', '08:00', '13:00', 1) RETURNING id`,
      [tenantId],
    );
    await q(`UPDATE classes SET shift_id = $1 WHERE tenant_id = $2`, [shiftId, tenantId]);
    for (let n = 1; n <= 3; n += 1) {
      await q(
        `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
         VALUES ($1, $2, $3, 'CLASS', $4, $5)`,
        [tenantId, shiftId, n, `0${7 + n}:00`, `0${7 + n}:45`],
      );
    }
    await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'Main routine', 'PUBLISHED', NOW())`,
      [tenantId, yearId],
    );
    // The current-year roll the enrolment history grows back from.
    await q(
      `INSERT INTO enrollments (tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status, enrolled_at)
       SELECT st.tenant_id, st.id, cs.class_id, cs.id, $2, 'ACTIVE', NOW()
         FROM students st JOIN class_sections cs ON cs.id = st.class_section_id
        WHERE st.tenant_id = $1`,
      [tenantId, yearId],
    );
  });

  const seed = () => ensureDashboardSeed(ds, tenantId, teacherEmail);

  const count = async (table: string, extra = '') =>
    (
      await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 ${extra}`, [tenantId])
    )[0].n as number;
  const snapshot = async () => ({
    sessions: await count('attendance_sessions'),
    records: await count('attendance_records'),
    staffRecords: await count('staff_attendance_records'),
    leaves: await count('leave_records'),
    exams: await count('exams'),
    results: await count('results'),
    seatPlans: await count('seat_plans'),
    seatPlanSchedules: await count('seat_plan_schedules'),
    guardians: await count('guardians'),
    years: await count('academic_years'),
    enrollments: await count('enrollments'),
    grids: await count('mark_grids'),
    topics: await count('syllabus_topics'),
    payments: await count('payments'),
    marks: await count('marks'),
    slots: await count('routine_slots'),
    slotTeachers: await count('routine_slot_teachers'),
    homework: await count('homework'),
    assignments: await count('homework_assignments'),
    submissions: await count('homework_submissions'),
    generations: await count('fee_generations'),
    schedules: await count('recurring_schedules'),
    audit: await count('audit_logs'),
    policies: await count('leave_policies'),
    rooms: await count('rooms'),
    failed: await count('communication_logs', `AND status = 'FAILED'`),
    fees: (
      await q(
        `SELECT count(*)::int AS n FROM student_fees sf JOIN students s ON s.id = sf.student_id WHERE s.tenant_id = $1`,
        [tenantId],
      )
    )[0].n as number,
  });

  it('keeps the e2e seed contract in step with the exam name', () => {
    expect(SEED_DASHBOARD_EXAM_NAME).toBe(DASHBOARD_EXAM_NAME);
  });

  it('keeps the e2e seed contract in step with the Group C names', () => {
    expect(SEED_DASHBOARD_GROUP_C.upcomingExam).toBe(DASHBOARD_GROUP_C.upcomingExam);
    expect(SEED_DASHBOARD_GROUP_C.familyHomework).toBe(DASHBOARD_GROUP_C.familyHomework[0]);
  });

  it('is idempotent: a second run adds no rows', async () => {
    await seed();
    const first = await snapshot();
    await seed();
    expect(await snapshot()).toEqual(first);
  });

  it('feeds every widget: 2 pending registers today, one absent staff, 3 recent failures', async () => {
    await seed();
    const today = localToday('Asia/Dhaka');

    // 3 sections, 2 left open today (the third stays finalised).
    expect(await count('attendance_sessions', `AND date = '${today}'`)).toBe(
      weekdayIsOff(today) ? 0 : 1,
    );
    expect(await count('staff_attendance_records', `AND status = 'ABSENT'`)).toBe(1);
    // The day-off demo (staff 2) and the teacher's own approved day.
    expect(await count('leave_records', `AND status = 'APPROVED'`)).toBe(2);
    expect(await count('leave_records', `AND status = 'PENDING'`)).toBe(1);
    expect(
      await count(
        'communication_logs',
        `AND status = 'FAILED' AND created_at >= NOW() - interval '7 days'`,
      ),
    ).toBe(3);
    // Draft exam, deadline today + 3 (D40), sitting began before today.
    const [exam] = await q(
      `SELECT e.status, e.mark_entry_deadline::text AS d, (SELECT MIN(date)::text FROM exam_schedules WHERE exam_id = e.id) AS first
         FROM exams e WHERE e.tenant_id = $1 AND e.name = $2`,
      [tenantId, DASHBOARD_EXAM_NAME],
    );
    expect(exam.status).toBe('DRAFT');
    expect(exam.d > today).toBe(true);
    expect(exam.first < today).toBe(true);
    // this month, last month, last year: bills and payments exist for all three.
    const months = await q(
      `SELECT DISTINCT to_char(sf.period_start, 'YYYY-MM') AS m FROM student_fees sf
         JOIN students s ON s.id = sf.student_id WHERE s.tenant_id = $1 AND sf.status = 'PAID'`,
      [tenantId],
    );
    expect(months).toHaveLength(3);
    // The at-risk pair: ABSENT on the last 4 registers they have.
    const absentRuns = await q(
      `SELECT student_id, count(*)::int AS n FROM attendance_records
        WHERE tenant_id = $1 AND status = 'ABSENT' GROUP BY student_id HAVING count(*) >= 4`,
      [tenantId],
    );
    expect(absentRuns.length).toBeGreaterThanOrEqual(2);
  });

  it('feeds the teacher widgets: routine, homework to check, a half-entered DRAFT grid, leave', async () => {
    await seed();
    const today = localToday('Asia/Dhaka');

    // Class slots on today's weekday (none on the Friday off day, which carries no slots).
    const [{ n: slotsToday }] = await q(
      `SELECT count(*)::int AS n FROM routine_slots rs
         JOIN routine_slot_teachers rst ON rst.routine_slot_id = rs.id AND rst.teacher_id = $1
        WHERE rs.weekday = EXTRACT(DOW FROM $2::date)`,
      [teacherId, today],
    );
    if (weekdayIsOff(today)) expect(slotsToday).toBe(0);
    else expect(slotsToday).toBeGreaterThanOrEqual(1);

    // Homework: submissions waiting in the teacher's own sections.
    const [{ n: submitted }] = await q(
      `SELECT count(*)::int AS n FROM homework_submissions WHERE tenant_id = $1 AND status = 'SUBMITTED'`,
      [tenantId],
    );
    expect(submitted).toBeGreaterThanOrEqual(1);

    // Marks: the teacher's grid is still DRAFT and fewer students are marked than on the roster.
    const [grid] = await q(
      `SELECT state FROM mark_grids WHERE tenant_id = $1 AND section_id = $2`,
      [tenantId, sectionBId],
    );
    expect(grid.state).toBe('DRAFT');
    const [{ marked }] = await q(
      `SELECT count(DISTINCT student_id)::int AS marked FROM marks WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(marked).toBeGreaterThanOrEqual(1);
    expect(marked).toBeLessThan(3);

    // Leave: policies exist and the teacher has one approved day this year.
    expect(await count('leave_policies')).toBe(5);
    const [leave] = await q(
      `SELECT lr.start_date::text AS d FROM leave_records lr
         JOIN staff_profiles sp ON sp.id = lr.staff_profile_id
        WHERE sp.user_id = $1 AND lr.status = 'APPROVED'`,
      [teacherUserId],
    );
    expect(leave.d.slice(0, 4)).toBe(today.slice(0, 4));
  });

  it('feeds the accountant widgets: three method groups today, a reversal, bills in all ageing buckets', async () => {
    await seed();
    const today = localToday('Asia/Dhaka');

    const methods = await q(
      `SELECT DISTINCT payment_method::text AS m FROM payments
        WHERE tenant_id = $1 AND idempotency_key LIKE 'seed:dashboard:w3:%'
          AND payment_date <= NOW() AND payment_date >= NOW() - interval '1 day'
          AND reversal_of_payment_id IS NULL`,
      [tenantId],
    );
    expect(methods.map((r: { m: string }) => r.m).sort()).toEqual(['BKASH', 'CARD', 'CASH']);
    expect(await count('payments', `AND reversal_of_payment_id IS NOT NULL`)).toBe(1);

    // Open bills 10 / 45 / 90 days past due: one in each of 0-30, 31-60 and 60+.
    const buckets = await q(
      `SELECT (CASE WHEN age <= 30 THEN '0_30' WHEN age <= 60 THEN '31_60' ELSE '60_PLUS' END) AS bucket
         FROM (SELECT ($2::date - sf.due_date) AS age FROM student_fees sf
                 JOIN students s ON s.id = sf.student_id
                 JOIN fee_structures fs ON fs.id = sf.fee_structure_id
                WHERE s.tenant_id = $1 AND fs.name = $3 AND sf.status = 'PENDING') x`,
      [tenantId, today, DASHBOARD_DUES_FEE_NAME],
    );
    expect(buckets.map((r: { bucket: string }) => r.bucket).sort()).toEqual([
      '0_30',
      '31_60',
      '60_PLUS',
    ]);
    // The two older ones are flagged for a reminder.
    const [{ n: flagged }] = await q(
      `SELECT count(*)::int AS n FROM student_fees sf JOIN students s ON s.id = sf.student_id
        WHERE s.tenant_id = $1 AND sf.reminder_threshold_date < $2::date`,
      [tenantId, today],
    );
    expect(flagged).toBe(2);
    expect(await count('fee_generations')).toBe(1);
    expect(await count('recurring_schedules', `AND is_active`)).toBe(1);
  });

  it('feeds the Group C routes: two published rounds, a processed one, a seat plan gap, an incomplete guardian, 4 past years', async () => {
    await seed();

    // Two PUBLISHED rounds with different publish times; the PROCESSED one is newer and unpublished.
    const rounds = await q(
      `SELECT name FROM exams WHERE tenant_id = $1 AND name = ANY($2::text[]) GROUP BY name`,
      [tenantId, [...DASHBOARD_GROUP_C.rounds, DASHBOARD_GROUP_C.processedRound]],
    );
    expect(rounds.map((r: { name: string }) => r.name).sort()).toEqual([
      DASHBOARD_GROUP_C.processedRound,
      ...DASHBOARD_GROUP_C.rounds,
    ]);
    const stamps = await q(
      `SELECT DISTINCT published_at FROM exams WHERE tenant_id = $1 AND status = 'PUBLISHED'`,
      [tenantId],
    );
    expect(stamps).toHaveLength(2);
    // Every published exam has at least one failing student (a pass rate below 100%).
    const clean = await q(
      `SELECT e.id FROM exams e WHERE e.tenant_id = $1 AND e.status = 'PUBLISHED'
          AND NOT EXISTS (SELECT 1 FROM results r WHERE r.exam_id = e.id AND r.is_fail)`,
      [tenantId],
    );
    expect(clean).toEqual([]);

    // Upcoming exam: 3 sittings, a DRAFT seat plan on 2 of them (so one needs a plan).
    const [sit] = await q(
      `SELECT count(*)::int AS n FROM exam_schedules es JOIN exams e ON e.id = es.exam_id
        WHERE e.tenant_id = $1 AND e.name = $2`,
      [tenantId, DASHBOARD_GROUP_C.upcomingExam],
    );
    expect(sit.n).toBe(3);
    const [plan] = await q(
      `SELECT sp.status, count(sps.id)::int AS linked FROM seat_plans sp
         LEFT JOIN seat_plan_schedules sps ON sps.seat_plan_id = sp.id
        WHERE sp.tenant_id = $1 GROUP BY sp.status`,
      [tenantId],
    );
    expect(plan).toEqual({ status: 'DRAFT', linked: 2 });

    // D33: one guardian is incomplete (no relationship, no phone).
    expect(
      await count(
        'guardians',
        `AND btrim(relationship) = '' AND phone IS NULL AND alternate_phone IS NULL`,
      ),
    ).toBe(1);

    // Four past years, growing towards the current one.
    const years = await q(
      `SELECT ay.name, count(e.id)::int AS n FROM academic_years ay
         LEFT JOIN enrollments e ON e.academic_year_id = ay.id
        WHERE ay.tenant_id = $1 AND NOT ay.is_current GROUP BY ay.name ORDER BY ay.name`,
      [tenantId],
    );
    expect(years).toHaveLength(4);
  });
});

const weekdayIsOff = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 5;
