import type { DataSource } from 'typeorm';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { resolveTenantSettings } from '../modules/schools/settings/tenant-settings-resolver';

// Like seed.evaluations.ts: must not import anything that reaches AppModule.

export const DASHBOARD_EXAM_NAME = 'Half-yearly';
export const DASHBOARD_FEE_NAME = 'Dashboard demo fee';
/** Own structure, so the overdue bill is found by student alone: its month moves with today. */
export const DASHBOARD_OVERDUE_FEE_NAME = 'Dashboard demo overdue fee';
export const DASHBOARD_LEAVE_REASONS = {
  approved: 'Dashboard demo: approved leave',
  pending: 'Dashboard demo: pending leave',
} as const;
const FAILED_KEY = 'seed:dashboard:failed:';
const TOPIC_STATUSES = ['DONE', 'DONE', 'IN_PROGRESS', 'PLANNED', 'PLANNED'] as const;
const WEEKLY_OFF = 5; // Friday, same as the attendance seeds
const SERIES_DAYS = 30;
const BILL = 1000;

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
  /** Tests pin one date so seeding and asserting can't straddle midnight. */
  todayOverride?: string,
): Promise<void> {
  const q = <R = Row>(sql: string, params: unknown[] = []): Promise<R[]> => ds.query(sql, params);

  const [school] = await q<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [tenantId],
  );
  const [year] = await q<{ id: string }>(
    `SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  );
  if (!school || !year) {
    console.warn('  Dashboard seed: no school / current academic year - skipping');
    return;
  }
  const today =
    todayOverride ??
    localToday(resolveTenantSettings(school.settings).region?.timezone ?? 'Asia/Dhaka');

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
  // Never leave every section pending: a one-section school keeps today finalised.
  const pending = [...sections]
    .sort((a, b) => Number(watchedIds.has(b.id)) - Number(watchedIds.has(a.id)))
    .slice(0, Math.min(2, sections.length - 1))
    .map((s) => s.id);

  const sectionIds = sections.map((s) => s.id);
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
  await seedBills(q, tenantId, year.id, today, billed, atRisk, oneSignal);
  await seedStaff(q, tenantId, today);
  await seedExams(q, tenantId, year.id, today, sections);
  await seedSyllabus(q, tenantId, sections);
  await seedFailedMessages(q, tenantId);
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

  /** One bill (found by student + structure + month; the overdue bill by student + its own
   * structure, since its month moves with today). `paid` adds the SUCCESS payment. */
  const bill = async (
    s: { id: string; class_id: string },
    periodStart: string,
    dueDate: string,
    paid: boolean,
    overdue = false,
  ) => {
    const structureId = await structureFor(
      s.class_id,
      overdue ? DASHBOARD_OVERDUE_FEE_NAME : DASHBOARD_FEE_NAME,
    );
    let [fee] = await q<{ id: string }>(
      overdue
        ? `SELECT id FROM student_fees WHERE student_id = $1 AND fee_structure_id = $2 AND deleted_at IS NULL`
        : `SELECT id FROM student_fees WHERE student_id = $1 AND fee_structure_id = $2 AND period_start = $3 AND deleted_at IS NULL`,
      overdue ? [s.id, structureId] : [s.id, structureId, periodStart],
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
      await q(
        `UPDATE student_fees SET period_start = $2, due_date = $3, updated_at = NOW() WHERE id = $1`,
        [fee.id, periodStart, dueDate],
      );
    }
    if (!paid) return;
    const key = `seed:dashboard:${s.id}:${periodStart}`;
    const [pay] = await q<{ id: string }>(
      `SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    if (pay) return;
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
    await bill(s, addDays(today, -100).slice(0, 8) + '01', addDays(today, -70), false, true);
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
) {
  const classIds = [...new Set(sections.map((s) => s.class_id))];
  for (const [ci, classId] of classIds.entries()) {
    const subjects = await q<{ subject_id: string }>(
      `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY subject_id LIMIT 2`,
      [tenantId, classId],
    );
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
      addDays(today, 4),
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
        if (!submitted) continue;
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
async function seedSyllabus(q: Q, tenantId: string, sections: { class_id: string }[]) {
  const classIds = [...new Set(sections.map((s) => s.class_id))];
  for (const [ci, classId] of classIds.entries()) {
    const [subject] = await q<{ subject_id: string }>(
      `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY subject_id LIMIT 1`,
      [tenantId, classId],
    );
    if (!subject) continue;
    const [have] = await q(
      `SELECT 1 FROM syllabus_topics WHERE tenant_id = $1 AND class_id = $2 AND subject_id = $3`,
      [tenantId, classId, subject.subject_id],
    );
    if (have) continue;
    for (const [i, _] of TOPIC_STATUSES.entries()) {
      const status = TOPIC_STATUSES[(i + ci) % TOPIC_STATUSES.length];
      await q(
        `INSERT INTO syllabus_topics (tenant_id, class_id, subject_id, name, sequence, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [tenantId, classId, subject.subject_id, `Chapter ${i + 1}`, i + 1, status],
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
