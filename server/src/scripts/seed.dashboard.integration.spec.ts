import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { ensureDashboardSeed } from './seed.dashboard';

describe('ensureDashboardSeed (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
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
  });

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
    grids: await count('mark_grids'),
    topics: await count('syllabus_topics'),
    payments: await count('payments'),
    failed: await count('communication_logs', `AND status = 'FAILED'`),
    fees: (
      await q(
        `SELECT count(*)::int AS n FROM student_fees sf JOIN students s ON s.id = sf.student_id WHERE s.tenant_id = $1`,
        [tenantId],
      )
    )[0].n as number,
  });

  it('is idempotent: a second run adds no rows', async () => {
    await ensureDashboardSeed(ds, tenantId);
    const first = await snapshot();
    await ensureDashboardSeed(ds, tenantId);
    expect(await snapshot()).toEqual(first);
  });

  it('feeds every widget: 2 pending registers today, one absent staff, 3 recent failures', async () => {
    await ensureDashboardSeed(ds, tenantId);
    const today = localToday('Asia/Dhaka');

    // 3 sections, 2 left open today (the third stays finalised).
    expect(await count('attendance_sessions', `AND date = '${today}'`)).toBe(
      weekdayIsOff(today) ? 0 : 1,
    );
    expect(await count('staff_attendance_records', `AND status = 'ABSENT'`)).toBe(1);
    expect(await count('leave_records', `AND status = 'APPROVED'`)).toBe(1);
    expect(await count('leave_records', `AND status = 'PENDING'`)).toBe(1);
    expect(
      await count(
        'communication_logs',
        `AND status = 'FAILED' AND created_at >= NOW() - interval '7 days'`,
      ),
    ).toBe(3);
    // Draft exam, deadline today + 4, sitting began before today.
    const [exam] = await q(
      `SELECT e.status, e.mark_entry_deadline::text AS d, (SELECT MIN(date)::text FROM exam_schedules WHERE exam_id = e.id) AS first
         FROM exams e WHERE e.tenant_id = $1`,
      [tenantId],
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
});

const weekdayIsOff = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 5;
