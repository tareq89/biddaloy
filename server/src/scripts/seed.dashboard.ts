import type { DataSource } from 'typeorm';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { resolveTenantSettings } from '../modules/schools/settings/tenant-settings-resolver';

// Like seed.evaluations.ts: must not import anything that reaches AppModule.

export const DASHBOARD_EXAM_NAME = 'Half-yearly';
export const DASHBOARD_FEE_NAME = 'Dashboard demo fee';
export const DASHBOARD_LEAVE_REASONS = {
  approved: 'Dashboard demo: approved leave',
  pending: 'Dashboard demo: pending leave',
} as const;
/** [8.10.7.3.99] The login whose teacher widgets the wave-3 rows feed (`e2e/seed-contract.ts`). */
export const DASHBOARD_TEACHER_EMAIL = 'teacher@biddaloy.test';
export const DASHBOARD_TEACHER_LEAVE_REASON = 'Dashboard demo: teacher leave';
export const DASHBOARD_HOMEWORK_TITLES = {
  teacher: 'Dashboard demo: homework',
  other: 'Dashboard demo: homework (other class)',
} as const;
export const DASHBOARD_DUES_FEE_NAME = 'Dashboard demo dues';
const SCHEDULE_NAME = 'Dashboard demo: monthly fees';
const DEMO_ROOM = { building: 'Dashboard demo', room_no: 'D-1' } as const;
const AUDIT_MARK = 'dashboard-demo';
const PAY_KEY = 'seed:dashboard:w3:';
/** Class-period slots per teaching weekday (Sun-Thu, Sat); Friday is the weekly off. */
const ROUTINE_WEEKDAYS = [0, 1, 2, 3, 4, 6] as const;
const FAILED_KEY = 'seed:dashboard:failed:';
const TOPIC_STATUSES = ['DONE', 'DONE', 'IN_PROGRESS', 'PLANNED', 'PLANNED'] as const;
const WEEKLY_OFF = 5; // Friday, same as the attendance seeds
const SERIES_DAYS = 30;
const BILL = 1000;
const AGEING_DAYS = [10, 45, 90] as const; // one bucket each: 0-30, 31-60, 60+

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number): string => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

type Row = Record<string, any>;

/**
 * [8.10.7.2.99] Rows that make every wave-2 dashboard widget non-empty for the
 * default school. All dates hang off the school's today (no literals, no RNG:
 * attendance marks come from a hash of student + date, so reruns agree).
 * Idempotent: every row is found by a natural key first; due dates, leave dates
 * and the SMS failures move with today on each run.
 */
export async function ensureDashboardSeed(
  ds: DataSource,
  tenantId: string,
  teacherEmail: string = DASHBOARD_TEACHER_EMAIL,
): Promise<void> {
  const q = <R = Row>(sql: string, params: unknown[] = []): Promise<R[]> => ds.query(sql, params);

  const [school] = await q<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [tenantId],
  );
  const [year] = await q<{ id: string; start_date: string }>(
    `SELECT id, start_date::text AS start_date FROM academic_years WHERE tenant_id = $1 AND is_current AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  );
  if (!school || !year) {
    console.warn('  Dashboard seed: no school / current academic year - skipping');
    return;
  }
  const timezone = resolveTenantSettings(school.settings).region?.timezone ?? 'Asia/Dhaka';
  const today = localToday(timezone);

  const sections = await q<{ id: string; class_id: string; class_name: string }>(
    `SELECT cs.id, cs.class_id, c.name AS class_name
       FROM class_sections cs
       JOIN classes c ON c.id = cs.class_id AND c.deleted_at IS NULL AND c.academic_year_id = $2
      WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL
      ORDER BY cs.id`,
    [tenantId, year.id],
  );
  if (sections.length === 0) {
    console.warn('  Dashboard seed: no sections in the current year - skipping');
    return;
  }

  // The 2 sections whose register stays open today: prefer the ones other attention
  // demos watch (class teacher's, the parent's child's) so those keep working.
  const watched = await q<{ id: string }>(
    `SELECT tcs.section_id AS id FROM teacher_class_sections tcs
      WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'CLASS_TEACHER'
     UNION
     SELECT st.class_section_id FROM students st
       JOIN student_guardians sg ON sg.student_id = st.id
       JOIN guardians g ON g.id = sg.guardian_id AND g.user_id IS NOT NULL
      WHERE st.tenant_id = $1`,
    [tenantId],
  );
  const watchedIds = new Set(watched.map((w) => w.id));
  const sectionIds = sections.map((s) => s.id);
  // The seed teacher (absent in a school without one: the teacher rows are then skipped).
  const teacher = await findTeacher(q, tenantId, teacherEmail, sectionIds);
  // Their own sections come first: the register journeys write that teacher's section for today.
  const mineIds = new Set((teacher?.rows ?? []).map((r) => r.section_id));
  const rank = (id: string) => Number(mineIds.has(id)) * 2 + Number(watchedIds.has(id));
  // Never leave every section pending: a one-section school keeps today finalised.
  const pending = [...sections]
    .sort((a, b) => rank(b.id) - rank(a.id))
    .slice(0, Math.min(2, sections.length - 1))
    .map((s) => s.id);

  // Students the demos must not disturb: parents' children (their alerts are seeded elsewhere).
  const students = await q<{ id: string; class_section_id: string; class_id: string }>(
    `SELECT st.id, st.class_section_id, cs.class_id
       FROM students st
       JOIN class_sections cs ON cs.id = st.class_section_id
      WHERE st.tenant_id = $1 AND st.deleted_at IS NULL AND st.class_section_id = ANY($2)
        AND NOT EXISTS (SELECT 1 FROM student_guardians sg
                          JOIN guardians g ON g.id = sg.guardian_id AND g.user_id IS NOT NULL
                         WHERE sg.student_id = st.id)
      ORDER BY st.id`,
    [tenantId, sectionIds],
  );
  const days = await seedAttendance(q, tenantId, sectionIds, pending, today);

  // The at-risk pair comes from sections whose last 4 registers are all this seed's own, so
  // their absent run cannot clash with registers other seeds wrote (attendance ops demo).
  const lastFour = days.slice(-4);
  const busy = new Set(
    (
      await q<{ section_id: string }>(
        `SELECT DISTINCT section_id FROM attendance_sessions
          WHERE tenant_id = $1 AND period_no IS NULL AND source <> 'SYSTEM' AND date BETWEEN $2 AND $3`,
        [tenantId, lastFour[0], today],
      )
    ).map((r) => r.section_id),
  );
  const open = students.filter(
    (s) => !pending.includes(s.class_section_id) && !busy.has(s.class_section_id),
  );
  const atRisk = open.slice(0, 2);
  const oneSignal = open[2];
  const billed = students.filter((s) => !atRisk.includes(s)).slice(0, 6);
  if (atRisk.length > 0) {
    await q(
      `UPDATE attendance_records r SET status = 'ABSENT', minutes_late = NULL
         FROM attendance_sessions s
        WHERE s.id = r.session_id AND s.tenant_id = $1 AND s.source = 'SYSTEM'
          AND s.period_no IS NULL AND s.date = ANY($3::date[]) AND r.student_id = ANY($2)`,
      [tenantId, atRisk.map((s) => s.id), lastFour],
    );
  }
  await seedBills(q, tenantId, year.id, today, billed, atRisk, oneSignal, agedStudents(billed));
  await seedStaff(q, tenantId, today);
  const mine = (teacher?.rows ?? []).filter(
    (r) => r.assignment_type === 'SUBJECT_TEACHER' && r.subject_id,
  );
  await seedExams(q, tenantId, year.id, today, sections, mine);
  await seedSyllabus(q, tenantId, sections, mine);
  await seedFailedMessages(q, tenantId);
  await seedGroupC(q, tenantId, year, today, sections, pending);

  // Wave 3: teacher and accountant widgets.
  const pool = billed.length > 0 ? billed : students;
  await seedAccountant(q, tenantId, year.id, today, timezone, pool);
  await seedAudit(q, tenantId, pool);
  // Wave 7: the "waiting for your approval" card (ADMIN / EXECUTIVE).
  await seedPendingApplications(q, tenantId, year.id, today, pool);
  if (!teacher) return;
  await seedStreak(q, tenantId, today, teacher, students);
  await seedMarks(q, tenantId, teacher);
  await seedHomework(q, tenantId, today, sections, teacher);
  await seedRoutine(q, tenantId, year, teacher);
  await seedTeacherLeave(q, tenantId, today, teacher.staffProfileId);
}

type Q = <R = Row>(sql: string, params?: unknown[]) => Promise<R[]>;

/** 30 days of finalised whole-day registers; today's too, except `pending` sections. Returns the working days. */
async function seedAttendance(
  q: Q,
  tenantId: string,
  sectionIds: string[],
  pending: string[],
  today: string,
): Promise<string[]> {
  const days = Array.from({ length: SERIES_DAYS }, (_, i) =>
    addDays(today, i - (SERIES_DAYS - 1)),
  ).filter((d) => weekday(d) !== WEEKLY_OFF);
  const pairs = sectionIds.flatMap((s) =>
    days.filter((d) => d !== today || !pending.includes(s)).map((d) => [s, d] as const),
  );
  await q(
    `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state, source, marked_at, finalized_at)
     SELECT $1, p.section_id, p.date, NULL, 'FINALIZED', 'SYSTEM', NOW(), NOW()
       FROM unnest($2::uuid[], $3::date[]) AS p(section_id, date)
      WHERE NOT EXISTS (SELECT 1 FROM attendance_sessions x
                         WHERE x.tenant_id = $1 AND x.section_id = p.section_id
                           AND x.date = p.date AND x.period_no IS NULL)`,
    [tenantId, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  // The status enum's type name comes from the catalog (it is not spelled out in the entity).
  const [{ udt_name: statusType }] = await q<{ udt_name: string }>(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'attendance_records' AND column_name = 'status'`,
  );
  // Only sessions this seed wrote (source SYSTEM) get marks; ~90% present, a few late/absent.
  await q(
    `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, minutes_late, source)
     SELECT s.tenant_id, s.id, st.id, s.date,
            (CASE WHEN h < 4 THEN 'ABSENT' WHEN h < 9 THEN 'LATE' ELSE 'PRESENT' END)::"${statusType}",
            CASE WHEN h >= 4 AND h < 9 THEN 10 END, 'SYSTEM'
       FROM attendance_sessions s
       JOIN students st ON st.class_section_id = s.section_id AND st.tenant_id = s.tenant_id
                       AND st.deleted_at IS NULL
      CROSS JOIN LATERAL (SELECT abs(hashtext(st.id::text || s.date::text)) % 100 AS h) x
      WHERE s.tenant_id = $1 AND s.section_id = ANY($2) AND s.source = 'SYSTEM'
        AND s.period_no IS NULL AND s.date BETWEEN $3 AND $4
     ON CONFLICT (session_id, student_id) DO NOTHING`,
    [tenantId, sectionIds, days[0], today],
  );
  return days;
}

/** Bills for this month, last month and the same month last year, with SUCCESS payments. */
async function seedBills(
  q: Q,
  tenantId: string,
  yearId: string,
  today: string,
  billed: { id: string; class_id: string }[],
  atRisk: { id: string; class_id: string }[],
  oneSignal: { id: string; class_id: string } | undefined,
  aged: { id: string; class_id: string }[],
) {
  const structureFor = async (classId: string, name: string): Promise<string> => {
    const [hit] = await q<{ id: string }>(
      `SELECT id FROM fee_structures WHERE tenant_id = $1 AND name = $2 AND class_id = $3 AND deleted_at IS NULL`,
      [tenantId, name, classId],
    );
    if (hit) return hit.id;
    const [row] = await q<{ id: string }>(
      `INSERT INTO fee_structures (tenant_id, fee_type, name, amount, class_id, academic_year_id, created_at, updated_at)
       VALUES ($1, 'OTHER', $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [tenantId, name, BILL, classId, yearId],
    );
    return row.id;
  };

  /** One bill (found by student + structure + month). `paid` adds the SUCCESS payment. */
  const bill = async (
    s: { id: string; class_id: string },
    periodStart: string,
    dueDate: string,
    paid: boolean,
    name: string = DASHBOARD_FEE_NAME,
  ): Promise<string> => {
    const structureId = await structureFor(s.class_id, name);
    let [fee] = await q<{ id: string }>(
      `SELECT id FROM student_fees WHERE student_id = $1 AND fee_structure_id = $2 AND period_start = $3 AND deleted_at IS NULL`,
      [s.id, structureId, periodStart],
    );
    if (!fee) {
      [fee] = await q<{ id: string }>(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
           total_amount, paid_amount, status, due_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'MONTH', $5, $6, $7, $8, NOW(), NOW()) RETURNING id`,
        [
          s.id,
          yearId,
          structureId,
          periodStart,
          BILL,
          paid ? BILL : 0,
          paid ? 'PAID' : 'PENDING',
          dueDate,
        ],
      );
    } else if (!paid) {
      await q(`UPDATE student_fees SET due_date = $2, updated_at = NOW() WHERE id = $1`, [
        fee.id,
        dueDate,
      ]);
    }
    if (!paid) return fee.id;
    const key = `seed:dashboard:${s.id}:${periodStart}`;
    const [pay] = await q<{ id: string }>(
      `SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    if (pay) return fee.id;
    const [created] = await q<{ id: string }>(
      `INSERT INTO payments (tenant_id, student_id, total_amount, payment_method, payment_status,
         payment_date, idempotency_key, remarks, created_at, updated_at)
       VALUES ($1, $2, $3, 'CASH', 'SUCCESS', $4, $5, 'Dashboard demo', NOW(), NOW()) RETURNING id`,
      [tenantId, s.id, BILL, `${periodStart}T06:00:00Z`, key],
    );
    await q(
      `INSERT INTO payment_allocations (payment_id, student_fee_id, allocated_amount, allocation_type, created_at)
       VALUES ($1, $2, $3, 'CURRENT', NOW())`,
      [created.id, fee.id, BILL],
    );
    return fee.id;
  };

  const months = [
    { start: `${today.slice(0, 7)}-01`, paidCount: 4 }, // this month: 2 still open
    { start: addMonths(today, -1), paidCount: 5 },
    { start: addMonths(today, -12), paidCount: 6 },
  ];
  for (const { start, paidCount } of months) {
    for (const [i, s] of billed.entries()) {
      // Open bills fall due later than today so no overdue signal appears for them.
      await bill(s, start, i < paidCount ? addDays(start, 10) : addDays(today, 20), i < paidCount);
    }
  }
  // At-risk signals: the pair's bill is 70 days overdue; one more student has only this signal.
  for (const s of [...atRisk, ...(oneSignal ? [oneSignal] : [])]) {
    await bill(s, addDays(today, -100).slice(0, 8) + '01', addDays(today, -70), false);
  }
  // Dues ageing: open bills 10 / 45 / 90 days past due, one per class. The 45- and 90-day ones are
  // also flagged for a reminder (threshold passed, no reminder log).
  for (const [i, s] of aged.entries()) {
    const age = AGEING_DAYS[i];
    const due = addDays(today, -age);
    const feeId = await bill(s, `${due.slice(0, 7)}-01`, due, false, DASHBOARD_DUES_FEE_NAME);
    await q(`UPDATE student_fees SET reminder_threshold_date = $2 WHERE id = $1`, [
      feeId,
      age >= 45 ? addDays(due, 5) : null,
    ]);
  }
}

/** Today's staff register (1 absent), one approved leave covering today, one pending. */
async function seedStaff(q: Q, tenantId: string, today: string) {
  const staff = await q<{ id: string }>(
    `SELECT sp.id FROM staff_profiles sp
       JOIN users u ON u.id = sp.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
      WHERE sp.tenant_id = $1 ORDER BY sp.id`,
    [tenantId],
  );
  if (staff.length < 3) return; // need an absent one, one on leave and one present
  await q(
    `INSERT INTO staff_attendance_sessions (tenant_id, date) VALUES ($1, $2) ON CONFLICT (tenant_id, date) DO NOTHING`,
    [tenantId, today],
  );
  const [session] = await q<{ id: string }>(
    `SELECT id FROM staff_attendance_sessions WHERE tenant_id = $1 AND date = $2`,
    [tenantId, today],
  );
  // staff[1] is on leave (left unmarked); staff[0] is the one absent without leave.
  for (const [i, s] of staff.entries()) {
    if (i === 1) continue;
    await q(
      `INSERT INTO staff_attendance_records (tenant_id, session_id, staff_profile_id, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (session_id, staff_profile_id) DO NOTHING`,
      [tenantId, session.id, s.id, i === 0 ? 'ABSENT' : 'PRESENT'],
    );
  }
  const leaves = [
    {
      who: staff[1].id,
      reason: DASHBOARD_LEAVE_REASONS.approved,
      status: 'APPROVED',
      from: today,
      to: addDays(today, 1),
    },
    {
      who: staff[2].id,
      reason: DASHBOARD_LEAVE_REASONS.pending,
      status: 'PENDING',
      from: addDays(today, 7),
      to: addDays(today, 8),
    },
  ];
  for (const l of leaves) {
    const [hit] = await q<{ id: string }>(
      `SELECT id FROM leave_records WHERE tenant_id = $1 AND staff_profile_id = $2 AND reason = $3`,
      [tenantId, l.who, l.reason],
    );
    if (hit) {
      await q(
        `UPDATE leave_records SET start_date = $2, end_date = $3, updated_at = NOW() WHERE id = $1`,
        [hit.id, l.from, l.to],
      );
    } else {
      await q(
        `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, reason, created_at, updated_at)
         VALUES ($1, $2, 'CASUAL', $3, $4, 2, $5, $6, NOW(), NOW())`,
        [tenantId, l.who, l.from, l.to, l.status, l.reason],
      );
    }
  }
}

/** A DRAFT "Half-yearly" exam per class: sitting began yesterday, entry due in 4 days, some grids in. */
async function seedExams(
  q: Q,
  tenantId: string,
  yearId: string,
  today: string,
  sections: { id: string; class_id: string; class_name: string }[],
  mine: TeacherRow[],
) {
  const classIds = [...new Set(sections.map((s) => s.class_id))];
  // The seed teacher's subjects sit among the exam's two, and their grids stay DRAFT (seedMarks).
  const taught = mine.map((r) => r.subject_id as string);
  const teacherGrids = new Set(mine.map((r) => `${r.section_id}:${r.subject_id}`));
  for (const [ci, classId] of classIds.entries()) {
    // The teacher's subject goes in even when the class has no `class_subjects` row for it
    // (the demo teacher's maths is assigned per section, not per class).
    const own = [...new Set(mine.filter((r) => r.class_id === classId).map((r) => r.subject_id))];
    const rest = await q<{ subject_id: string }>(
      `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2
        ORDER BY (subject_id = ANY($3::uuid[])) DESC, subject_id LIMIT 2`,
      [tenantId, classId, taught],
    );
    const subjects = [...own.map((subject_id) => ({ subject_id: subject_id as string })), ...rest]
      .filter((s, i, all) => all.findIndex((o) => o.subject_id === s.subject_id) === i)
      .slice(0, Math.max(2, own.length));
    if (subjects.length === 0) continue;
    let [exam] = await q<{ id: string }>(
      `SELECT id FROM exams WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4 AND deleted_at IS NULL`,
      [tenantId, yearId, classId, DASHBOARD_EXAM_NAME],
    );
    if (!exam) {
      [exam] = await q<{ id: string }>(
        `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'TERM', 'DRAFT', NOW(), NOW()) RETURNING id`,
        [tenantId, yearId, classId, DASHBOARD_EXAM_NAME],
      );
    }
    // Dates move with today on every run, like the attention seeds.
    await q(`UPDATE exams SET mark_entry_deadline = $2, updated_at = NOW() WHERE id = $1`, [
      exam.id,
      addDays(today, 3), // D40: "deadline in 3 days" on the teacher's card
    ]);
    for (const [si, { subject_id }] of subjects.entries()) {
      const [component] = await q(
        `SELECT 1 FROM exam_components WHERE exam_id = $1 AND subject_id = $2 AND deleted_at IS NULL`,
        [exam.id, subject_id],
      );
      if (!component) {
        await q(
          `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, source, full_marks, pass_marks, sequence, created_at, updated_at)
           VALUES ($1, $2, $3, 'Written', 'WRITTEN', 'MANUAL', 100, 33, 1, NOW(), NOW())`,
          [tenantId, exam.id, subject_id],
        );
      }
      const date = addDays(today, si - 1); // first subject yesterday
      const [sched] = await q<{ id: string }>(
        `SELECT id FROM exam_schedules WHERE exam_id = $1 AND subject_id = $2 AND deleted_at IS NULL`,
        [exam.id, subject_id],
      );
      if (sched) {
        await q(`UPDATE exam_schedules SET date = $2, updated_at = NOW() WHERE id = $1`, [
          sched.id,
          date,
        ]);
      } else {
        await q(
          `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, '10:00', '13:00', NOW(), NOW())`,
          [tenantId, exam.id, subject_id, date],
        );
      }
      // The first class has no grids in (clearly lowest), the second half, the rest all.
      const classSections = sections.filter((s) => s.class_id === classId);
      for (const [gi, sec] of classSections.entries()) {
        const submitted = ci > 1 || (ci === 1 && gi % 2 === 0);
        if (!submitted || teacherGrids.has(`${sec.id}:${subject_id}`)) continue;
        await q(
          `INSERT INTO mark_grids (tenant_id, exam_id, section_id, subject_id, state, submitted_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'SUBMITTED', NOW(), NOW(), NOW())
           ON CONFLICT (exam_id, section_id, subject_id) DO NOTHING`,
          [tenantId, exam.id, sec.id, subject_id],
        );
      }
    }
  }
}

/** Five topics per class that has none yet, in mixed states. */
async function seedSyllabus(
  q: Q,
  tenantId: string,
  sections: { class_id: string }[],
  mine: TeacherRow[],
) {
  const classIds = [...new Set(sections.map((s) => s.class_id))];
  const targets: { classId: string; subjectId: string }[] = [];
  for (const classId of classIds) {
    const [subject] = await q<{ subject_id: string }>(
      `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY subject_id LIMIT 1`,
      [tenantId, classId],
    );
    if (subject) targets.push({ classId, subjectId: subject.subject_id });
  }
  // The seed teacher's own (class, subject) pairs, so "my syllabus progress" has topics.
  for (const r of mine) {
    if (!targets.some((t) => t.classId === r.class_id && t.subjectId === r.subject_id)) {
      targets.push({ classId: r.class_id, subjectId: r.subject_id as string });
    }
  }
  for (const [ci, { classId, subjectId }] of targets.entries()) {
    const [have] = await q(
      `SELECT 1 FROM syllabus_topics WHERE tenant_id = $1 AND class_id = $2 AND subject_id = $3`,
      [tenantId, classId, subjectId],
    );
    if (have) continue;
    for (const [i, _] of TOPIC_STATUSES.entries()) {
      const status = TOPIC_STATUSES[(i + ci) % TOPIC_STATUSES.length];
      await q(
        `INSERT INTO syllabus_topics (tenant_id, class_id, subject_id, name, sequence, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [tenantId, classId, subjectId, `Chapter ${i + 1}`, i + 1, status],
      );
    }
  }
}

/** 3 FAILED SMS inside the 7-day window, 1 older (outside it). */
async function seedFailedMessages(q: Q, tenantId: string) {
  const ages = [1, 3, 5, 20];
  for (const [n, days] of ages.entries()) {
    const key = `${FAILED_KEY}${n + 1}`;
    const [log] = await q<{ id: string }>(
      `SELECT id FROM communication_logs WHERE tenant_id = $1 AND reference_key = $2`,
      [tenantId, key],
    );
    if (log) {
      await q(
        `UPDATE communication_logs SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`,
        [log.id, days],
      );
    } else {
      await q(
        `INSERT INTO communication_logs (tenant_id, medium, status, trigger, recipient_name, recipient_address, message_body, reference_key, created_at, updated_at)
         VALUES ($1, 'SMS', 'FAILED', 'AUTOMATED', 'Demo guardian', '01700000000', 'Demo failed message', $2, NOW() - make_interval(days => $3), NOW())`,
        [tenantId, key, days],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Wave 3 [8.10.7.3.99]: teacher and accountant widgets
// ---------------------------------------------------------------------------

type TeacherRow = {
  section_id: string;
  class_id: string;
  assignment_type: string;
  subject_id: string | null;
};
type TeacherCtx = {
  teacherId: string;
  userId: string;
  staffProfileId: string;
  rows: TeacherRow[];
};
type Stu = { id: string; class_id: string };

/** One student per class for the three ageing bills: those who already owe something come first. */
function agedStudents<S extends Stu>(billed: S[]): S[] {
  const ordered = [...billed.slice(4), ...billed.slice(0, 4)];
  const picked: S[] = [];
  for (const s of ordered) {
    if (picked.length < AGEING_DAYS.length && !picked.some((p) => p.class_id === s.class_id)) {
      picked.push(s);
    }
  }
  for (const s of ordered) {
    if (picked.length < AGEING_DAYS.length && !picked.includes(s)) picked.push(s);
  }
  // A school with fewer students than buckets reuses one (the periods differ, so no clash).
  while (picked.length > 0 && picked.length < AGEING_DAYS.length) picked.push(picked[0]);
  return picked;
}

async function findTeacher(
  q: Q,
  tenantId: string,
  email: string,
  sectionIds: string[],
): Promise<TeacherCtx | null> {
  const [t] = await q<{ id: string; user_id: string; staff_profile_id: string }>(
    `SELECT t.id, t.user_id, t.staff_profile_id FROM teachers t
       JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
      WHERE t.tenant_id = $1 AND t.deleted_at IS NULL AND u.email = $2`,
    [tenantId, email],
  );
  if (!t) return null;
  const rows = await q<TeacherRow>(
    `SELECT tcs.section_id, cs.class_id, tcs.assignment_type::text AS assignment_type, tcs.subject_id
       FROM teacher_class_sections tcs
       JOIN class_sections cs ON cs.id = tcs.section_id
      WHERE tcs.tenant_id = $1 AND tcs.teacher_id = $2 AND tcs.section_id = ANY($3::uuid[])
      ORDER BY tcs.assignment_type::text, tcs.section_id`,
    [tenantId, t.id, sectionIds],
  );
  return { teacherId: t.id, userId: t.user_id, staffProfileId: t.staff_profile_id, rows };
}

/**
 * Accountant widgets: SUCCESS payments today in CASH, BKASH and CARD plus a reversed cash payment,
 * payments in two earlier months of this year, a fee generation for this month and one active
 * monthly schedule. (The ageing and flagged bills come from `seedBills`.)
 */
async function seedAccountant(
  q: Q,
  tenantId: string,
  yearId: string,
  today: string,
  timezone: string,
  pool: Stu[],
) {
  if (pool.length > 0) {
    // This morning in the school's day, but never after now (the widget counts up to now).
    const [{ d: morning }] = await q<{ d: Date }>(
      `SELECT LEAST(NOW(), (($1::date)::timestamp AT TIME ZONE $2) + interval '6 hours') AS d`,
      [today, timezone],
    );
    /** Found by key; its date moves with today on every run. */
    const pay = async (
      name: string,
      student: Stu,
      method: string,
      amount: number,
      at: Date | string,
      reversalOf: string | null = null,
    ): Promise<string> => {
      const key = `${PAY_KEY}${name}`;
      const [hit] = await q<{ id: string }>(
        `SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, key],
      );
      if (hit) {
        await q(`UPDATE payments SET payment_date = $2, updated_at = NOW() WHERE id = $1`, [
          hit.id,
          at,
        ]);
        return hit.id;
      }
      const [row] = await q<{ id: string }>(
        `INSERT INTO payments (tenant_id, student_id, total_amount, payment_method, payment_status,
           payment_date, idempotency_key, remarks, reversal_of_payment_id, reversal_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Dashboard demo', $8, $9, NOW(), NOW()) RETURNING id`,
        [
          tenantId,
          student.id,
          amount,
          method,
          reversalOf ? 'REFUNDED' : 'SUCCESS',
          at,
          key,
          reversalOf,
          reversalOf ? 'Dashboard demo: entered twice' : null,
        ],
      );
      return row.id;
    };
    const who = (i: number) => pool[i % pool.length];
    await pay('cash', who(0), 'CASH', 1200, morning);
    await pay('bkash', who(1), 'BKASH', 800, morning);
    await pay('card', who(2), 'CARD', 1500, morning);
    // A cash payment taken in error, then reversed: the original and its compensating row.
    const wrong = await pay('cash-reversed', who(3), 'CASH', 500, morning);
    const reversal = await pay('cash-reversal', who(3), 'CASH', 500, morning, wrong);
    await q(
      `UPDATE payments SET reversed_by_payment_id = $2, payment_status = 'REFUNDED' WHERE id = $1`,
      [wrong, reversal],
    );
    // Earlier months of this year (the year-to-date chart); none when today is in January.
    for (const back of [2, 3]) {
      const month = addMonths(today, -back);
      if (month.slice(0, 4) !== today.slice(0, 4)) continue;
      await pay(
        `month-${back}`,
        who(back),
        'CASH',
        3000 + back * 250,
        `${month.slice(0, 8)}15T06:00:00Z`,
      );
    }
  }

  // A fee generation for this month, owning this month's demo bills.
  const periodStart = `${today.slice(0, 7)}-01`;
  const [structure] = await q<{ id: string }>(
    `SELECT id FROM fee_structures WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [tenantId, DASHBOARD_FEE_NAME],
  );
  if (structure) {
    let [gen] = await q<{ id: string }>(
      `SELECT id FROM fee_generations
        WHERE tenant_id = $1 AND period_start = $2 AND deleted_at IS NULL AND structures @> $3::jsonb`,
      [tenantId, periodStart, JSON.stringify([{ name: DASHBOARD_FEE_NAME }])],
    );
    if (!gen) {
      [gen] = await q<{ id: string }>(
        `INSERT INTO fee_generations (tenant_id, academic_year_id, period_start, period_type, due_date, source,
           duplicate_strategy, notify_families, structures, student_count, generated_count, skipped_count,
           removed_count, created_at)
         VALUES ($1, $2, $3, 'MONTH', $4, 'MANUAL', 'SKIP', false, $5::jsonb, 0, 0, 0, 0, NOW()) RETURNING id`,
        [
          tenantId,
          yearId,
          periodStart,
          addDays(periodStart, 9),
          JSON.stringify([
            { id: structure.id, name: DASHBOARD_FEE_NAME, fee_type: 'OTHER', amount: BILL },
          ]),
        ],
      );
    }
    await q(
      `UPDATE student_fees SET fee_generation_id = $1
        WHERE fee_generation_id IS NULL AND period_start = $2 AND deleted_at IS NULL
          AND fee_structure_id IN (SELECT id FROM fee_structures WHERE tenant_id = $3 AND name = $4)`,
      [gen.id, periodStart, tenantId, DASHBOARD_FEE_NAME],
    );
    await q(
      `UPDATE fee_generations SET
         student_count = (SELECT COUNT(DISTINCT student_id) FROM student_fees WHERE fee_generation_id = $1 AND deleted_at IS NULL),
         generated_count = (SELECT COUNT(*) FROM student_fees WHERE fee_generation_id = $1 AND deleted_at IS NULL)
       WHERE id = $1`,
      [gen.id],
    );
  }

  // One active monthly schedule. It starts next month, so no scheduler run lands on the demo today.
  const starts = addMonths(today, 1);
  const ends = addDays(addMonths(today, 7), -1);
  const [schedule] = await q<{ id: string }>(
    `SELECT id FROM recurring_schedules WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [tenantId, SCHEDULE_NAME],
  );
  if (schedule) {
    await q(
      `UPDATE recurring_schedules SET starts_on = $2, ends_on = $3, is_active = true, updated_at = NOW() WHERE id = $1`,
      [schedule.id, starts, ends],
    );
  } else {
    await q(
      `INSERT INTO recurring_schedules (tenant_id, academic_year_id, name, audience, rule, period_type,
         due_days_after_period_start, starts_on, ends_on, notify_families, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, '{"enrollment_status":"ACTIVE"}'::jsonb, '{"kind":"MONTHLY","day_of_month":1}'::jsonb,
         'MONTH', 9, $4, $5, false, true, NOW(), NOW())`,
      [tenantId, yearId, SCHEDULE_NAME, starts, ends],
    );
  }
}

/** Three audit rows for the "recent activity" card; the table is append-only, so keyed by a marker. */
async function seedAudit(q: Q, tenantId: string, pool: Stu[]) {
  const [have] = await q(
    `SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND new_values ->> 'seed' = $2 LIMIT 1`,
    [tenantId, AUDIT_MARK],
  );
  if (have || pool.length === 0) return;
  const [admin] = await q<{ id: string }>(
    `SELECT id FROM users WHERE email = 'admin@biddaloy.test' AND deleted_at IS NULL`,
  );
  const rows = [
    { action: 'CREATE', minutes: 30, before: null, after: { seed: AUDIT_MARK } },
    {
      action: 'UPDATE',
      minutes: 90,
      before: { phone: '01700000000' },
      after: { seed: AUDIT_MARK, phone: '01800000000' },
    },
    {
      action: 'UPDATE',
      minutes: 150,
      before: { address: 'Old' },
      after: { seed: AUDIT_MARK, address: 'New' },
    },
  ];
  for (const [i, r] of rows.entries()) {
    await q(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, performed_by_user_id, old_values, new_values, created_at)
       VALUES ($1, $2, 'Student', $3, $4, $5::jsonb, $6::jsonb, NOW() - make_interval(mins => $7))`,
      [
        tenantId,
        r.action,
        pool[i % pool.length].id,
        admin?.id ?? null,
        r.before ? JSON.stringify(r.before) : null,
        JSON.stringify(r.after),
        r.minutes,
      ],
    );
  }
}

/**
 * 5 pending staff leaves (step 0, LEAVE_APPROVE) + 2 pending fee waivers parked at the
 * admin's own step (step 1), so the seed ADMIN and EXECUTIVE both see 7 in the inbox.
 * Found by `letter_text` (a stable marker); only the age moves with today's run.
 */
async function seedPendingApplications(
  q: Q,
  tenantId: string,
  yearId: string,
  today: string,
  pool: Stu[],
) {
  const staff = await q<{ id: string; user_id: string }>(
    `SELECT sp.id, sp.user_id FROM staff_profiles sp WHERE sp.tenant_id = $1 ORDER BY sp.id`,
    [tenantId],
  );
  if (staff.length === 0) return;
  const applicant = staff[0].user_id; // a staff member files all of them: no PII, no extra users
  const serialYear = Number(today.slice(0, 4));
  const rows = [
    ...[0, 1, 2, 3, 4].map((i) => ({
      type: 'STAFF_LEAVE',
      step: 0,
      staff: staff[i % staff.length].id,
      student: null as string | null,
      ageDays: 5 - i,
      payload: { leave_type: 'CASUAL', reason: 'Dashboard demo' },
    })),
    ...(pool.length === 0
      ? []
      : [0, 1].map((i) => ({
          type: 'FEE_WAIVER',
          step: 1,
          staff: null as string | null,
          student: pool[i % pool.length].id,
          ageDays: 2 - i,
          payload: { reason: 'Dashboard demo' },
        }))),
  ];
  for (const [i, r] of rows.entries()) {
    const marker = `Dashboard demo: pending application ${i + 1}`;
    const [hit] = await q(`SELECT 1 FROM applications WHERE tenant_id = $1 AND letter_text = $2`, [
      tenantId,
      marker,
    ]);
    if (hit) continue;
    await q(
      `INSERT INTO applications
         (tenant_id, type, status, source, serial_year, serial_no, academic_year_id, applicant_user_id,
          subject_student_id, subject_staff_profile_id, payload, start_date, end_date,
          current_step, letter_text, letter_locale, created_at, updated_at)
       SELECT $1, $2::applications_type_enum, 'PENDING', 'APP', $3, coalesce(max(serial_no), 0) + 1, $4, $5,
              $6, $7, $8::jsonb, $9::date, $9::date, $10, $11, 'en',
              NOW() - make_interval(days => $12), NOW()
         FROM applications WHERE tenant_id = $1 AND serial_year = $3`,
      [
        tenantId,
        r.type,
        serialYear,
        yearId,
        applicant,
        r.student,
        r.staff,
        JSON.stringify(r.payload),
        today,
        r.step,
        marker,
        r.ageDays,
      ],
    );
  }
}

/** The teacher's homeroom: one student absent on the section's last 4 registers ("4 school days in a row"). */
async function seedStreak(
  q: Q,
  tenantId: string,
  today: string,
  teacher: TeacherCtx,
  students: Stu[],
) {
  const home = teacher.rows.find((r) => r.assignment_type === 'CLASS_TEACHER');
  if (!home) return;
  const [pick] = await q<{ id: string }>(
    `SELECT id FROM students WHERE id = ANY($1::uuid[]) AND class_section_id = $2
      ORDER BY roll_number DESC, id LIMIT 1`,
    [students.map((s) => s.id), home.section_id],
  );
  if (!pick) return;
  await q(
    `UPDATE attendance_records SET status = 'ABSENT', minutes_late = NULL
      WHERE tenant_id = $1 AND student_id = $2 AND session_id IN (
        SELECT id FROM attendance_sessions
         WHERE tenant_id = $1 AND section_id = $3 AND period_no IS NULL AND date <= $4
         ORDER BY date DESC LIMIT 4)`,
    [tenantId, pick.id, home.section_id, today],
  );
}

/** The teacher's SUBJECT_TEACHER grid stays DRAFT with marks for about half the roster. */
async function seedMarks(q: Q, tenantId: string, teacher: TeacherCtx) {
  for (const r of teacher.rows) {
    if (r.assignment_type !== 'SUBJECT_TEACHER' || !r.subject_id) continue;
    const [exam] = await q<{ id: string }>(
      `SELECT id FROM exams WHERE tenant_id = $1 AND class_id = $2 AND name = $3 AND status = 'DRAFT' AND deleted_at IS NULL LIMIT 1`,
      [tenantId, r.class_id, DASHBOARD_EXAM_NAME],
    );
    if (!exam) continue;
    const components = await q<{ id: string }>(
      `SELECT id FROM exam_components WHERE exam_id = $1 AND subject_id = $2 AND deleted_at IS NULL`,
      [exam.id, r.subject_id],
    );
    if (components.length === 0) continue;
    await q(
      `INSERT INTO mark_grids (tenant_id, exam_id, section_id, subject_id, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'DRAFT', NOW(), NOW()) ON CONFLICT (exam_id, section_id, subject_id) DO NOTHING`,
      [tenantId, exam.id, r.section_id, r.subject_id],
    );
    const roster = await q<{ id: string }>(
      `SELECT id FROM students WHERE tenant_id = $1 AND class_section_id = $2 AND deleted_at IS NULL ORDER BY roll_number, id`,
      [tenantId, r.section_id],
    );
    const entered = roster.length > 1 ? Math.ceil(roster.length / 2) : 0;
    for (const student of roster.slice(0, entered)) {
      for (const c of components) {
        await q(
          `INSERT INTO marks (tenant_id, exam_id, student_id, subject_id, component_id, value, status, entered_by)
           VALUES ($1, $2, $3, $4, $5, 40 + abs(hashtext($3::uuid::text || $5::uuid::text)) % 55, 'PRESENT', $6)
           ON CONFLICT (exam_id, student_id, component_id) DO NOTHING`,
          [tenantId, exam.id, student.id, r.subject_id, c.id, teacher.userId],
        );
      }
    }
  }
}

/**
 * Homework due in the last 7 days. The teacher's (in the sections they have in their homeroom
 * class): all but the last student SUBMITTED. A second class's: SUBMITTED and NOT_SUBMITTED
 * alternate. Dates move with today.
 */
async function seedHomework(
  q: Q,
  tenantId: string,
  today: string,
  sections: { id: string; class_id: string }[],
  teacher: TeacherCtx,
) {
  const subjectOf = async (classId: string, prefer?: string | null): Promise<string | null> => {
    if (prefer) return prefer;
    const [s] = await q<{ subject_id: string }>(
      `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY subject_id LIMIT 1`,
      [tenantId, classId],
    );
    return s?.subject_id ?? null;
  };

  const give = async (
    title: string,
    classId: string,
    subjectId: string,
    sectionIds: string[],
    dueDaysAgo: number,
    status: (index: number, count: number) => string,
  ) => {
    let [hw] = await q<{ id: string }>(
      `SELECT id FROM homework WHERE tenant_id = $1 AND title = $2`,
      [tenantId, title],
    );
    if (!hw) {
      [hw] = await q<{ id: string }>(
        `INSERT INTO homework (tenant_id, title, subject_id, class_id, grading_mode)
         VALUES ($1, $2, $3, $4, 'TICK') RETURNING id`,
        [tenantId, title, subjectId, classId],
      );
    }
    const due = addDays(today, -dueDaysAgo);
    for (const sectionId of sectionIds) {
      let [assignment] = await q<{ id: string }>(
        `SELECT id FROM homework_assignments WHERE homework_id = $1 AND section_id = $2`,
        [hw.id, sectionId],
      );
      if (assignment) {
        await q(
          `UPDATE homework_assignments SET assigned_date = $2, due_date = $3, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
          [assignment.id, addDays(due, -3), due],
        );
      } else {
        [assignment] = await q<{ id: string }>(
          `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING id`,
          [tenantId, hw.id, sectionId, addDays(due, -3), due],
        );
      }
      const roster = await q<{ id: string }>(
        `SELECT id FROM students WHERE tenant_id = $1 AND class_section_id = $2 AND deleted_at IS NULL ORDER BY roll_number, id`,
        [tenantId, sectionId],
      );
      for (const [i, student] of roster.entries()) {
        await q(
          `INSERT INTO homework_submissions (tenant_id, assignment_id, student_id, status)
           VALUES ($1, $2, $3, $4) ON CONFLICT (assignment_id, student_id) DO NOTHING`,
          [tenantId, assignment.id, student.id, status(i, roster.length)],
        );
      }
    }
  };

  const home = teacher.rows.find((r) => r.assignment_type === 'CLASS_TEACHER') ?? teacher.rows[0];
  if (home) {
    const taught = teacher.rows.find(
      (r) => r.class_id === home.class_id && r.assignment_type === 'SUBJECT_TEACHER',
    );
    const subjectId = await subjectOf(home.class_id, taught?.subject_id);
    if (subjectId) {
      const mine = [
        ...new Set(
          teacher.rows.filter((r) => r.class_id === home.class_id).map((r) => r.section_id),
        ),
      ];
      await give(DASHBOARD_HOMEWORK_TITLES.teacher, home.class_id, subjectId, mine, 1, (i, n) =>
        i < n - 1 || n === 1 ? 'SUBMITTED' : 'NOT_SUBMITTED',
      );
    }
  }
  // Another class (outside the teacher's scope): a mix.
  const other = sections.find((s) => s.class_id !== home?.class_id);
  if (other) {
    const subjectId = await subjectOf(other.class_id);
    if (subjectId) {
      await give(DASHBOARD_HOMEWORK_TITLES.other, other.class_id, subjectId, [other.id], 3, (i) =>
        i % 2 === 0 ? 'SUBMITTED' : 'NOT_SUBMITTED',
      );
    }
  }
}

/**
 * Up to 4 class-period slots on every teaching weekday for the teacher, in their sections, in one
 * demo room (the room marks them as this seed's, so a rerun never mistakes them for other bookings).
 */
async function seedRoutine(
  q: Q,
  tenantId: string,
  year: { id: string; start_date: string },
  teacher: TeacherCtx,
) {
  const [routine] = await q<{ id: string }>(
    `SELECT id FROM routines WHERE tenant_id = $1 AND academic_year_id = $2 AND state = 'PUBLISHED' AND deleted_at IS NULL`,
    [tenantId, year.id],
  );
  const sectionIds = [...new Set(teacher.rows.map((r) => r.section_id))].slice(0, 2);
  if (!routine || sectionIds.length === 0) return;

  let [room] = await q<{ id: string }>(
    `SELECT id FROM rooms WHERE tenant_id = $1 AND building = $2 AND room_no = $3`,
    [tenantId, DEMO_ROOM.building, DEMO_ROOM.room_no],
  );
  if (room) {
    await q(`UPDATE rooms SET deleted_at = NULL WHERE id = $1`, [room.id]);
  } else {
    [room] = await q<{ id: string }>(
      `INSERT INTO rooms (tenant_id, building, room_no, capacity) VALUES ($1, $2, $3, 40) RETURNING id`,
      [tenantId, DEMO_ROOM.building, DEMO_ROOM.room_no],
    );
  }

  // Per section: the class's class-period slots (breaks left out) and the subject taught there.
  const plan: { sectionId: string; periodIds: string[]; subjectId: string }[] = [];
  for (const sectionId of sectionIds) {
    const [info] = await q<{ shift_id: string | null; class_id: string }>(
      `SELECT c.shift_id, c.id AS class_id FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = $1`,
      [sectionId],
    );
    const periods = info?.shift_id
      ? await q<{ id: string }>(
          `SELECT id FROM period_slots WHERE shift_id = $1 AND kind = 'CLASS' ORDER BY sequence`,
          [info.shift_id],
        )
      : [];
    const taught = teacher.rows.find((r) => r.section_id === sectionId && r.subject_id);
    const subjectId =
      taught?.subject_id ??
      (
        await q<{ subject_id: string }>(
          `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY subject_id LIMIT 1`,
          [tenantId, info?.class_id],
        )
      )[0]?.subject_id;
    if (periods.length > 0 && subjectId) {
      plan.push({ sectionId, periodIds: periods.map((p) => p.id), subjectId });
    }
  }
  if (plan.length === 0) return;

  for (const weekdayNo of ROUTINE_WEEKDAYS) {
    // Periods the teacher already teaches on this weekday elsewhere (not in the demo room).
    const busy = new Set(
      (
        await q<{ period_slot_id: string }>(
          `SELECT rs.period_slot_id FROM routine_slots rs
             JOIN routine_slot_teachers rst ON rst.routine_slot_id = rs.id AND rst.teacher_id = $2
            WHERE rs.tenant_id = $1 AND rs.routine_id = $3 AND rs.weekday = $4
              AND rs.room_id IS DISTINCT FROM $5`,
          [tenantId, teacher.teacherId, routine.id, weekdayNo, room.id],
        )
      ).map((r) => r.period_slot_id),
    );
    let made = 0;
    for (let n = 0; made < 4 && n < 8; n += 1) {
      const target = plan[n % plan.length];
      const periodId = target.periodIds[n];
      if (!periodId || busy.has(periodId)) continue;
      const [taken] = await q<{ id: string; room_id: string | null }>(
        `SELECT id, room_id FROM routine_slots WHERE routine_id = $1 AND section_id = $2 AND period_slot_id = $3 AND weekday = $4`,
        [routine.id, target.sectionId, periodId, weekdayNo],
      );
      // Someone else's booking in that cell: leave it.
      if (taken && taken.room_id !== room.id) continue;
      let slotId = taken?.id;
      if (!slotId) {
        const [created] = await q<{ id: string }>(
          `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, room_id,
             recurrence, recurrence_offset, valid_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'WEEKLY', 0, $8) RETURNING id`,
          [
            tenantId,
            routine.id,
            target.sectionId,
            periodId,
            weekdayNo,
            target.subjectId,
            room.id,
            year.start_date,
          ],
        );
        slotId = created.id;
      }
      await q(
        `INSERT INTO routine_slot_teachers (tenant_id, routine_slot_id, teacher_id)
         VALUES ($1, $2, $3) ON CONFLICT (routine_slot_id, teacher_id) DO NOTHING`,
        [tenantId, slotId, teacher.teacherId],
      );
      busy.add(periodId);
      made += 1;
    }
  }
}

/** One approved casual-leave day this year (a recent working day), so the balance card shows usage. */
async function seedTeacherLeave(q: Q, tenantId: string, today: string, staffProfileId: string) {
  // The default quotas, for a school that has none (migration 1789800014000 seeds these).
  await q(
    `INSERT INTO leave_policies (tenant_id, leave_type, annual_quota_days)
     SELECT $1, v.leave_type::leave_type_enum, v.quota
       FROM (VALUES ('CASUAL', 10), ('SICK', 14), ('EARNED', 15), ('MATERNITY', 112), ('PATERNITY', 7)) AS v(leave_type, quota)
     ON CONFLICT (tenant_id, leave_type) DO NOTHING`,
    [tenantId],
  );
  const jan1 = `${today.slice(0, 4)}-01-01`;
  let day = addDays(today, -3) < jan1 ? jan1 : addDays(today, -3);
  while (weekday(day) === WEEKLY_OFF && day > jan1) day = addDays(day, -1);
  const [hit] = await q<{ id: string }>(
    `SELECT id FROM leave_records WHERE tenant_id = $1 AND staff_profile_id = $2 AND reason = $3`,
    [tenantId, staffProfileId, DASHBOARD_TEACHER_LEAVE_REASON],
  );
  if (hit) {
    await q(
      `UPDATE leave_records SET start_date = $2, end_date = $2, updated_at = NOW() WHERE id = $1`,
      [hit.id, day],
    );
  } else {
    await q(
      `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, reason, created_at, updated_at)
       VALUES ($1, $2, 'CASUAL', $3, $3, 1, 'APPROVED', $4, NOW(), NOW())`,
      [tenantId, staffProfileId, day, DASHBOARD_TEACHER_LEAVE_REASON],
    );
  }
}

export const DASHBOARD_GROUP_C = {
  rounds: ['Dashboard demo: first term', 'Dashboard demo: mid term'],
  processedRound: 'Dashboard demo: final',
  upcomingExam: 'Dashboard demo: upcoming',
  seatPlan: 'Dashboard demo: seating (draft)',
  incompleteGuardian: 'Dashboard demo: incomplete guardian',
  familyHomework: [
    'Dashboard demo: family homework',
    'Dashboard demo: family homework (later)',
    'Dashboard demo: family homework (today)',
  ],
  holiday: 'Dashboard demo: school holiday',
} as const;
/** Days from today each family homework title is due (same order as `familyHomework`). */
const FAMILY_HOMEWORK_DUE_IN = [1, 5, 0] as const;
const FAMILY_EMAILS = ['student@biddaloy.test', 'parent@biddaloy.test'] as const;
const PAST_YEARS = 4;

/**
 * [8.10.7.4.99] Rows for the Group C routes (committee, exam controller, office staff, family).
 * Dates hang off `today` / NOW(); natural keys are the fixed names above, so reruns add nothing.
 */
async function seedGroupC(
  q: Q,
  tenantId: string,
  year: { id: string; start_date: string },
  today: string,
  sections: { id: string; class_id: string }[],
  pending: string[],
) {
  // Plain students only: no login, no guardian login (the portal demos own those children).
  const students = await q<{ id: string; class_section_id: string; class_id: string }>(
    `SELECT st.id, st.class_section_id, cs.class_id
       FROM students st JOIN class_sections cs ON cs.id = st.class_section_id
      WHERE st.tenant_id = $1 AND st.deleted_at IS NULL AND st.user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM student_guardians sg
                          JOIN guardians g ON g.id = sg.guardian_id AND g.user_id IS NOT NULL
                         WHERE sg.student_id = st.id)
      ORDER BY st.id`,
    [tenantId],
  );
  const classIds = [...new Set(sections.map((s) => s.class_id))].filter((c) =>
    students.some((s) => s.class_id === c),
  );

  await seedRounds(q, tenantId, year.id, classIds.slice(0, 3), students);
  await seedUpcomingExam(q, tenantId, year.id, today, classIds[0]);
  await seedIncompleteGuardian(q, tenantId, students.at(-1)?.id);
  await seedEnrollmentHistory(q, tenantId, year.start_date);
  await seedFamilyHomework(q, tenantId, today, sections);
  await seedFamilyFacts(q, tenantId, year, today, pending);
}

/** Two PUBLISHED rounds (pass-rate spread) and a newer PROCESSED one the committee card must ignore. */
async function seedRounds(
  q: Q,
  tenantId: string,
  yearId: string,
  classIds: string[],
  students: { id: string; class_id: string }[],
) {
  const [scale] = await q<{ id: string }>(
    `SELECT id FROM grading_scales WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [tenantId],
  );
  if (!scale) return;
  const rounds = [
    { name: DASHBOARD_GROUP_C.rounds[0], status: 'PUBLISHED', ageDays: 60 },
    { name: DASHBOARD_GROUP_C.rounds[1], status: 'PUBLISHED', ageDays: 20 },
    { name: DASHBOARD_GROUP_C.processedRound, status: 'PROCESSED', ageDays: 0 },
  ];
  for (const [ci, classId] of classIds.entries()) {
    const roster = students.filter((s) => s.class_id === classId).slice(0, 6);
    for (const [ri, round] of rounds.entries()) {
      let [exam] = await q<{ id: string }>(
        `SELECT id FROM exams WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4 AND deleted_at IS NULL`,
        [tenantId, yearId, classId, round.name],
      );
      if (!exam) {
        [exam] = await q<{ id: string }>(
          `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'TERM', $5, NOW(), NOW()) RETURNING id`,
          [tenantId, yearId, classId, round.name, round.status],
        );
      }
      if (round.status === 'PUBLISHED') {
        await q(
          `UPDATE exams SET published_at = NOW() - make_interval(days => $2), updated_at = NOW() WHERE id = $1`,
          [exam.id, round.ageDays],
        );
      }
      // First round: one failure per class. Second: class 1 fails 1, class 2 fails 2, ... (a spread).
      // The PROCESSED round fails one student, which would show if it leaked into the pass rate.
      const fails = ri === 1 ? ci + 1 : 1;
      for (const [i, student] of roster.entries()) {
        const [have] = await q(`SELECT 1 FROM results WHERE exam_id = $1 AND student_id = $2`, [
          exam.id,
          student.id,
        ]);
        if (have) continue;
        const fail = i < fails;
        await q(
          `INSERT INTO results (id, tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail,
                                grading_scale_id, grading_scale_revision, rule_version, computed_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1, 'dashboard-demo', NOW())`,
          [
            tenantId,
            exam.id,
            student.id,
            fail ? 20 : 70,
            fail ? 0 : 4,
            fail ? 'F' : 'A',
            fail,
            scale.id,
          ],
        );
      }
    }
  }
}

/** An exam with 3 sittings next week; a DRAFT seat plan covers only 2 of them. */
async function seedUpcomingExam(
  q: Q,
  tenantId: string,
  yearId: string,
  today: string,
  classId: string | undefined,
) {
  if (!classId) return;
  const subjects = await q<{ id: string }>(
    `SELECT id FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 3`,
    [tenantId],
  );
  if (subjects.length < 3) return;
  let [exam] = await q<{ id: string }>(
    `SELECT id FROM exams WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4 AND deleted_at IS NULL`,
    [tenantId, yearId, classId, DASHBOARD_GROUP_C.upcomingExam],
  );
  if (!exam) {
    [exam] = await q<{ id: string }>(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'TERM', 'DRAFT', NOW(), NOW()) RETURNING id`,
      [tenantId, yearId, classId, DASHBOARD_GROUP_C.upcomingExam],
    );
  }
  let [plan] = await q<{ id: string }>(
    `SELECT id FROM seat_plans WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [tenantId, DASHBOARD_GROUP_C.seatPlan],
  );
  if (!plan) {
    [plan] = await q<{ id: string }>(
      `INSERT INTO seat_plans (tenant_id, name, status, seat_order_mode, created_at, updated_at)
       VALUES ($1, $2, 'DRAFT', 'SEQUENTIAL', NOW(), NOW()) RETURNING id`,
      [tenantId, DASHBOARD_GROUP_C.seatPlan],
    );
  }
  for (const [i, subject] of subjects.entries()) {
    const date = addDays(today, 7 + i);
    let [sched] = await q<{ id: string }>(
      `SELECT id FROM exam_schedules WHERE exam_id = $1 AND subject_id = $2 AND deleted_at IS NULL`,
      [exam.id, subject.id],
    );
    if (sched) {
      await q(`UPDATE exam_schedules SET date = $2, updated_at = NOW() WHERE id = $1`, [
        sched.id,
        date,
      ]);
    } else {
      [sched] = await q<{ id: string }>(
        `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '10:00', '13:00', NOW(), NOW()) RETURNING id`,
        [tenantId, exam.id, subject.id, date],
      );
    }
    if (i >= 2) continue; // the last sitting stays without a plan
    const [linked] = await q(
      `SELECT 1 FROM seat_plan_schedules WHERE seat_plan_id = $1 AND exam_schedule_id = $2 AND deleted_at IS NULL`,
      [plan.id, sched.id],
    );
    if (!linked) {
      await q(
        `INSERT INTO seat_plan_schedules (tenant_id, seat_plan_id, exam_schedule_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [tenantId, plan.id, sched.id],
      );
    }
  }
}

/** One guardian with no relationship and no phone (D33), attached to a plain student. */
async function seedIncompleteGuardian(q: Q, tenantId: string, studentId: string | undefined) {
  if (!studentId) return;
  let [guardian] = await q<{ id: string }>(
    `SELECT id FROM guardians WHERE tenant_id = $1 AND full_name = $2 AND deleted_at IS NULL`,
    [tenantId, DASHBOARD_GROUP_C.incompleteGuardian],
  );
  if (!guardian) {
    [guardian] = await q<{ id: string }>(
      `INSERT INTO guardians (tenant_id, full_name, relationship, phone, alternate_phone, is_primary_contact, created_at, updated_at)
       VALUES ($1, $2, '', NULL, NULL, false, NOW(), NOW()) RETURNING id`,
      [tenantId, DASHBOARD_GROUP_C.incompleteGuardian],
    );
  }
  await q(
    `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [studentId, guardian.id],
  );
}

/**
 * Four past academic years, each with a few more students on the roll than the one before it, so
 * `committee-enrollment` has a trend. GRADUATED (counted by the card) keeps every "the ACTIVE
 * enrolment" lookup pointing at the current year only.
 */
async function seedEnrollmentHistory(q: Q, tenantId: string, yearStart: string) {
  const current = await q<{ student_id: string; class_id: string; section_id: string | null }>(
    `SELECT e.student_id, e.class_id, e.section_id
       FROM enrollments e JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current
      WHERE e.tenant_id = $1 ORDER BY e.student_id`,
    [tenantId],
  );
  if (current.length === 0) return;
  for (let n = 1; n <= PAST_YEARS; n += 1) {
    const start = addMonths(yearStart, -12 * n);
    const name = `${start.slice(0, 4)}-${Number(start.slice(0, 4)) + 1}`;
    let [past] = await q<{ id: string }>(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, name],
    );
    if (!past) {
      [past] = await q<{ id: string }>(
        `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW()) RETURNING id`,
        [tenantId, name, start, addDays(addMonths(start, 12), -1)],
      );
    }
    const onRoll = Math.max(1, Math.round(current.length * (1 - 0.12 * n)));
    for (const row of current.slice(0, onRoll)) {
      const [have] = await q(
        `SELECT 1 FROM enrollments WHERE student_id = $1 AND academic_year_id = $2`,
        [row.student_id, past.id],
      );
      if (have) continue;
      await q(
        `INSERT INTO enrollments (tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status, enrolled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'GRADUATED', $6, NOW(), NOW())`,
        [tenantId, row.student_id, row.class_id, row.section_id, past.id, start],
      );
    }
  }
}

/** Homework in the sections of `student@` and `parent@`'s children: due tomorrow and in five days. */
async function seedFamilyHomework(
  q: Q,
  tenantId: string,
  today: string,
  sections: { id: string; class_id: string }[],
) {
  const own = await q<{ id: string; class_id: string }>(
    `SELECT DISTINCT cs.id, cs.class_id
       FROM students st JOIN class_sections cs ON cs.id = st.class_section_id
      WHERE st.tenant_id = $1 AND st.deleted_at IS NULL
        AND (st.user_id IN (SELECT id FROM users WHERE email = $2)
          OR st.id IN (SELECT sg.student_id FROM student_guardians sg
                         JOIN guardians g ON g.id = sg.guardian_id
                         JOIN users u ON u.id = g.user_id AND u.email = $3))`,
    [tenantId, FAMILY_EMAILS[0], FAMILY_EMAILS[1]],
  );
  const known = new Set(sections.map((s) => s.id));
  for (const [ti, title] of DASHBOARD_GROUP_C.familyHomework.entries()) {
    const due = addDays(today, FAMILY_HOMEWORK_DUE_IN[ti]);
    for (const section of own.filter((s) => known.has(s.id))) {
      const [subject] = await q<{ id: string }>(
        `SELECT subject_id AS id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2
         UNION ALL SELECT id FROM subjects WHERE tenant_id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [tenantId, section.class_id],
      );
      if (!subject) continue;
      let [hw] = await q<{ id: string }>(
        `SELECT id FROM homework WHERE tenant_id = $1 AND class_id = $2 AND title = $3`,
        [tenantId, section.class_id, title],
      );
      if (!hw) {
        [hw] = await q<{ id: string }>(
          `INSERT INTO homework (tenant_id, title, subject_id, class_id, grading_mode)
           VALUES ($1, $2, $3, $4, 'TICK') RETURNING id`,
          [tenantId, title, subject.id, section.class_id],
        );
      }
      const [assignment] = await q<{ id: string }>(
        `SELECT id FROM homework_assignments WHERE homework_id = $1 AND section_id = $2`,
        [hw.id, section.id],
      );
      if (assignment) {
        await q(
          `UPDATE homework_assignments SET assigned_date = $2, due_date = $3, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
          [assignment.id, today, due],
        );
      } else {
        await q(
          `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
          [tenantId, hw.id, section.id, today, due],
        );
      }
    }
  }
}

/**
 * [8.10.7.5.99] What the portal overview shows for `parent@`'s children: today's mark, an earlier
 * absent day this month, a published result in both rounds (GPA rises) and a holiday 20 days out.
 * Marks are only set where the base register seed already wrote the session, so the "pending
 * register" counts of the dashboards do not move. A second child, if any, is ABSENT today.
 */
async function seedFamilyFacts(
  q: Q,
  tenantId: string,
  year: { id: string },
  today: string,
  pending: string[],
) {
  const kids = await q<{ id: string; class_id: string; class_section_id: string }>(
    `SELECT DISTINCT st.id, cs.class_id, st.class_section_id
       FROM students st JOIN class_sections cs ON cs.id = st.class_section_id
       JOIN student_guardians sg ON sg.student_id = st.id
       JOIN guardians g ON g.id = sg.guardian_id
       JOIN users u ON u.id = g.user_id AND u.email = $2
      WHERE st.tenant_id = $1 AND st.deleted_at IS NULL
      ORDER BY st.id`,
    [tenantId, FAMILY_EMAILS[1]],
  );
  const first = kids[0];
  if (!first) return;

  const monthStart = `${today.slice(0, 7)}-01`;
  let missed = monthStart;
  while (missed < today && weekday(missed) === WEEKLY_OFF) missed = addDays(missed, 1);
  const [{ udt_name: statusType }] = await q<{ udt_name: string }>(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'attendance_records' AND column_name = 'status'`,
  );
  // Writes the child's mark, adding the day's whole-day register first if the base seed has none
  // (never for a section left pending on purpose today).
  const mark = async (
    kid: { id: string; class_section_id: string },
    date: string,
    status: string,
  ) => {
    if (date === today && pending.includes(kid.class_section_id)) return;
    await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state, source, marked_at, finalized_at)
       SELECT $1, $2, $3, NULL, 'FINALIZED', 'SYSTEM', NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM attendance_sessions x
                           WHERE x.tenant_id = $1 AND x.section_id = $2 AND x.date = $3 AND x.period_no IS NULL)`,
      [tenantId, kid.class_section_id, date],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, minutes_late, source)
       SELECT $1, s.id, $4, $3, $5::text::"${statusType}", NULL, 'SYSTEM' FROM attendance_sessions s
        WHERE s.tenant_id = $1 AND s.section_id = $2 AND s.date = $3 AND s.period_no IS NULL
       ON CONFLICT (session_id, student_id) DO UPDATE SET status = EXCLUDED.status, minutes_late = NULL`,
      [tenantId, kid.class_section_id, date, kid.id, status],
    );
  };
  await mark(first, today, 'PRESENT');
  if (missed < today) await mark(first, missed, 'ABSENT');
  if (kids[1]) await mark(kids[1], today, 'ABSENT');

  // A published result per round for each child; the later round has the higher GPA (a trend).
  const [scale] = await q<{ id: string }>(
    `SELECT id FROM grading_scales WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [tenantId],
  );
  if (scale) {
    for (const [ri, name] of DASHBOARD_GROUP_C.rounds.entries()) {
      for (const kid of kids) {
        let [exam] = await q<{ id: string }>(
          `SELECT id FROM exams WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4 AND deleted_at IS NULL`,
          [tenantId, year.id, kid.class_id, name],
        );
        if (!exam) {
          [exam] = await q<{ id: string }>(
            `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, published_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'TERM', 'PUBLISHED', NOW() - make_interval(days => $5), NOW(), NOW()) RETURNING id`,
            [tenantId, year.id, kid.class_id, name, ri === 0 ? 60 : 20],
          );
        }
        await q(
          `INSERT INTO results (id, tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail,
                                grading_scale_id, grading_scale_revision, rule_version, computed_at, published_at)
           SELECT gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, $7, 1, 'dashboard-demo', NOW(),
                  NOW() - make_interval(days => $8)
            WHERE NOT EXISTS (SELECT 1 FROM results WHERE exam_id = $2 AND student_id = $3)`,
          [
            tenantId,
            exam.id,
            kid.id,
            ri === 0 ? 60 : 75,
            ri === 0 ? 3 : 4,
            ri === 0 ? 'B' : 'A',
            scale.id,
            ri === 0 ? 60 : 20,
          ],
        );
      }
    }
  }

  // A HOLIDAY 20 days ahead, unless the school already has one in the next 60 days.
  const [near] = await q(
    `SELECT 1 FROM calendar_events WHERE tenant_id = $1 AND type = 'HOLIDAY' AND deleted_at IS NULL
        AND start_date BETWEEN $2 AND $3`,
    [tenantId, today, addDays(today, 60)],
  );
  if (!near) {
    await q(
      `INSERT INTO calendar_events (tenant_id, academic_year_id, start_date, end_date, name, type, published_at)
       VALUES ($1, $2, $3, $3, $4, 'HOLIDAY', NOW())`,
      [tenantId, year.id, addDays(today, 20), DASHBOARD_GROUP_C.holiday],
    );
  }
}
