import type { DataSource } from 'typeorm';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { resolveTenantSettings } from '../modules/schools/settings/tenant-settings-resolver';

// Like seed.evaluations.ts: must not import anything that reaches AppModule.

export const ATTENTION_TEACHER_EMAIL = 'teacher@biddaloy.test';
export const ATTENTION_HOMEWORK_TITLES = [
  'Attention demo: due today',
  'Attention demo: due tomorrow',
] as const;
export const ATTENTION_FAILED_LOGS = 10;
export const ATTENTION_PARENT_EMAIL = 'parent@biddaloy.test';
export const ATTENTION_DEMO_FEE = 'Attention demo fee';
export const ATTENTION_DEMO_EXAM = 'Attention demo exam';

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * [67.3.08] Rows that make the W3 attention rules fire for the default school:
 * two homework (due today / tomorrow) nobody has submitted for the demo class
 * teacher's section, and 10 recent FAILED SMS logs. Idempotent; due dates move
 * to the current school day on every run.
 */
export async function ensureAttentionRulesSeed(ds: DataSource, tenantId: string): Promise<void> {
  await ensureStaffRulesSeed(ds, tenantId);
  await ensureFamilyRulesSeed(ds, tenantId);
}

async function ensureStaffRulesSeed(ds: DataSource, tenantId: string): Promise<void> {
  const q = <R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<R[]> =>
    ds.query(sql, params);

  const [school] = await q<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [tenantId],
  );
  const [section] = await q<{ section_id: string; class_id: string }>(
    `SELECT tcs.section_id, cs.class_id
     FROM users u
     JOIN teachers te ON te.user_id = u.id AND te.tenant_id = $1 AND te.deleted_at IS NULL
     JOIN teacher_class_sections tcs ON tcs.teacher_id = te.id AND tcs.tenant_id = $1
       AND tcs.assignment_type = 'CLASS_TEACHER'
     JOIN class_sections cs ON cs.id = tcs.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
     WHERE u.email = $2
     ORDER BY tcs.created_at LIMIT 1`,
    [tenantId, ATTENTION_TEACHER_EMAIL],
  );
  if (!school || !section) {
    console.warn(
      `  Attention rules seed: no class-teacher section for ${ATTENTION_TEACHER_EMAIL} - skipping`,
    );
    return;
  }

  const today = localToday(resolveTenantSettings(school.settings).region?.timezone ?? 'Asia/Dhaka');
  // Subject: today's routine slot for the section, else any subject of its class.
  const [subject] = await q<{ subject_id: string }>(
    `SELECT subject_id FROM (
       SELECT rs.subject_id, 0 AS pri, ps.starts_at AS ord FROM routine_slots rs
         JOIN routines r ON r.id = rs.routine_id AND r.tenant_id = $1 AND r.deleted_at IS NULL AND r.state = 'PUBLISHED'
         JOIN period_slots ps ON ps.id = rs.period_slot_id AND ps.tenant_id = $1
        WHERE rs.tenant_id = $1 AND rs.section_id = $2 AND rs.weekday = EXTRACT(DOW FROM $3::date)
          AND rs.valid_from <= $3::date AND (rs.valid_to IS NULL OR rs.valid_to >= $3::date)
       UNION ALL
       SELECT subject_id, 1, NULL FROM class_subjects WHERE tenant_id = $1 AND class_id = $4
     ) s ORDER BY pri, ord NULLS LAST LIMIT 1`,
    [tenantId, section.section_id, today, section.class_id],
  );
  if (!subject) {
    console.warn('  Attention rules seed: no subject for the section - skipping homework');
  } else {
    const dues = [today, addDays(today, 1)];
    for (const [i, title] of ATTENTION_HOMEWORK_TITLES.entries()) {
      let [hw] = await q<{ id: string }>(
        `SELECT h.id FROM homework h
         JOIN homework_assignments a ON a.homework_id = h.id AND a.section_id = $3
         WHERE h.tenant_id = $1 AND h.title = $2 LIMIT 1`,
        [tenantId, title, section.section_id],
      );
      if (!hw) {
        [hw] = await q<{ id: string }>(
          `INSERT INTO homework (tenant_id, title, subject_id, class_id, grading_mode, attachments, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'TICK', '[]', NOW(), NOW()) RETURNING id`,
          [tenantId, title, subject.subject_id, section.class_id],
        );
        // Posted a day back: homework.not_submitted skips homework posted after its trigger.
        await q(
          `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW() - interval '1 day', NOW())`,
          [tenantId, hw.id, section.section_id, today, dues[i]],
        );
      } else {
        await q(
          `UPDATE homework_assignments SET assigned_date = $4, due_date = $5, status = 'ACTIVE',
             created_at = NOW() - interval '1 day', updated_at = NOW()
           WHERE tenant_id = $1 AND homework_id = $2 AND section_id = $3`,
          [tenantId, hw.id, section.section_id, today, dues[i]],
        );
      }
    }
  }

  for (let n = 1; n <= ATTENTION_FAILED_LOGS; n++) {
    const key = `seed:attention:failed:${n}`;
    const [log] = await q<{ id: string }>(
      `SELECT id FROM communication_logs WHERE tenant_id = $1 AND reference_key = $2`,
      [tenantId, key],
    );
    if (log) {
      // Keep the row inside the rule's 24 h window.
      await q(`UPDATE communication_logs SET updated_at = NOW() WHERE id = $1`, [log.id]);
    } else {
      await q(
        `INSERT INTO communication_logs (tenant_id, medium, status, trigger, recipient_name, recipient_address, message_body, reference_key, created_at, updated_at)
         VALUES ($1, 'SMS', 'FAILED', 'AUTOMATED', 'Demo guardian', '01700000000', 'Demo failed message', $2, NOW(), NOW())`,
        [tenantId, key],
      );
    }
  }
}

/**
 * [67.4.07] Family rules for `parent@biddaloy.test`'s child: a fee due in 2 days
 * (fees.due_soon) and an exam tomorrow (exams.tomorrow). Homework due tomorrow is
 * the staff block's row when the child sits in the class teacher's section.
 * Idempotent; both dates move to the current school day on every run.
 * Not seeded: child.absent_today (today's register is unmarked on purpose),
 * results.published and the calendar-dependent rules - integration specs cover them.
 */
async function ensureFamilyRulesSeed(ds: DataSource, tenantId: string): Promise<void> {
  const q = <R = Record<string, any>>(sql: string, params: unknown[] = []): Promise<R[]> =>
    ds.query(sql, params);

  const [school] = await q<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [tenantId],
  );
  const [child] = await q<{ student_id: string; class_id: string; year_id: string }>(
    `SELECT st.id AS student_id, c.id AS class_id, c.academic_year_id AS year_id
     FROM users u
     JOIN guardians g ON g.user_id = u.id AND g.tenant_id = $1 AND g.deleted_at IS NULL
     JOIN student_guardians sg ON sg.guardian_id = g.id
     JOIN students st ON st.id = sg.student_id AND st.tenant_id = $1 AND st.deleted_at IS NULL
     JOIN class_sections cs ON cs.id = st.class_section_id AND cs.tenant_id = $1
     JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
     WHERE u.email = $2
     ORDER BY st.roll_number, st.created_at LIMIT 1`,
    [tenantId, ATTENTION_PARENT_EMAIL],
  );
  if (!school || !child) {
    console.warn(
      `  Attention rules seed: no child linked to ${ATTENTION_PARENT_EMAIL} - skipping family block`,
    );
    return;
  }
  const today = localToday(resolveTenantSettings(school.settings).region?.timezone ?? 'Asia/Dhaka');

  // Fee due soon: one PENDING bill; period_start stays where the first run put it.
  let [structure] = await q<{ id: string }>(
    `SELECT id FROM fee_structures WHERE tenant_id = $1 AND name = $2 AND class_id = $3 AND deleted_at IS NULL`,
    [tenantId, ATTENTION_DEMO_FEE, child.class_id],
  );
  structure ??= (
    await q<{ id: string }>(
      `INSERT INTO fee_structures (tenant_id, fee_type, name, amount, class_id, academic_year_id, created_at, updated_at)
       VALUES ($1, 'OTHER', $2, 500, $3, $4, NOW(), NOW()) RETURNING id`,
      [tenantId, ATTENTION_DEMO_FEE, child.class_id, child.year_id],
    )
  )[0];
  const feeDue = addDays(today, 2);
  const [fee] = await q<{ id: string }>(
    `SELECT id FROM student_fees WHERE student_id = $1 AND fee_structure_id = $2 AND deleted_at IS NULL`,
    [child.student_id, structure.id],
  );
  if (fee) {
    await q(
      `UPDATE student_fees SET due_date = $2, status = 'PENDING', paid_amount = 0, updated_at = NOW() WHERE id = $1`,
      [fee.id, feeDue],
    );
  } else {
    await q(
      `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
         total_amount, paid_amount, status, due_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'MONTH', 500, 0, 'PENDING', $5, NOW(), NOW())`,
      [child.student_id, child.year_id, structure.id, `${today.slice(0, 7)}-01`, feeDue],
    );
  }

  // Exam tomorrow: a DRAFT exam, one component and its sitting (every component scheduled).
  const [subject] = await q<{ subject_id: string }>(
    `SELECT subject_id FROM class_subjects WHERE tenant_id = $1 AND class_id = $2 ORDER BY created_at LIMIT 1`,
    [tenantId, child.class_id],
  );
  if (!subject) {
    console.warn('  Attention rules seed: no subject for the child class - skipping demo exam');
    return;
  }
  let [exam] = await q<{ id: string }>(
    `SELECT id FROM exams WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND name = $4 AND deleted_at IS NULL`,
    [tenantId, child.year_id, child.class_id, ATTENTION_DEMO_EXAM],
  );
  if (!exam) {
    [exam] = await q<{ id: string }>(
      `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'TERM', 'DRAFT', NOW(), NOW()) RETURNING id`,
      [tenantId, child.year_id, child.class_id, ATTENTION_DEMO_EXAM],
    );
    await q(
      `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence, created_at, updated_at)
       VALUES ($1, $2, $3, 'Written', 'WRITTEN', 100, 1, NOW(), NOW())`,
      [tenantId, exam.id, subject.subject_id],
    );
    await q(
      `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '10:00', '12:00', NOW(), NOW())`,
      [tenantId, exam.id, subject.subject_id, addDays(today, 1)],
    );
  } else {
    await q(
      `UPDATE exam_schedules SET date = $2, updated_at = NOW() WHERE exam_id = $1 AND deleted_at IS NULL`,
      [exam.id, addDays(today, 1)],
    );
  }
}
