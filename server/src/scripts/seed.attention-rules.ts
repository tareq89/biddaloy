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
        await q(
          `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW())`,
          [tenantId, hw.id, section.section_id, today, dues[i]],
        );
      } else {
        await q(
          `UPDATE homework_assignments SET assigned_date = $4, due_date = $5, status = 'ACTIVE', updated_at = NOW()
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
