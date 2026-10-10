import type { DataSource } from 'typeorm';
import type { AlertRuleMeta } from '@biddaloy/shared';
import type { FamilyAccessService } from '../../../students/family-access.service';
import type { RuleFinding } from '../rule.types';

/** One child's slice of a family rule: everything but the shared child keys and recipients. */
export interface ChildItem {
  studentId: string;
  dedupeKey: string;
  actionUrl: string;
  params?: Record<string, string | number>;
  expiresAt?: Date;
}

/**
 * Turns per-child items into findings. One label query and ONE family lookup for
 * the whole run. Recipients are limited to `meta.roles`. A child nobody can be
 * told about is dropped, unless `keepWithoutRecipients` (the two
 * `guardianSmsFallback` rules: the D29 sweep texts guardians who have no login).
 */
export async function childFindings(
  ds: DataSource,
  family: FamilyAccessService,
  tenantId: string,
  meta: AlertRuleMeta,
  items: ChildItem[],
  keepWithoutRecipients = false,
): Promise<RuleFinding[]> {
  if (!items.length) return [];
  const ids = [...new Set(items.map((i) => i.studentId))];
  const [labels, users]: [
    { id: string; full_name: string; section_id: string; section_label: string }[],
    Awaited<ReturnType<FamilyAccessService['familyUsersForStudents']>>,
  ] = await Promise.all([
    ds.query(
      `SELECT s.id, s.full_name, cs.id AS section_id, c.name || '-' || cs.section_name AS section_label
       FROM students s
       JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = $1
       JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
       WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`,
      [tenantId, ids],
    ),
    family.familyUsersForStudents(tenantId, ids),
  ]);
  const label = new Map(labels.map((l) => [l.id, l]));
  const allowed = new Set<string>(meta.roles);
  const findings: RuleFinding[] = [];
  for (const item of items) {
    const l = label.get(item.studentId);
    if (!l) continue;
    const recipients = users
      .filter((u) => u.studentId === item.studentId && allowed.has(u.role))
      .map((u) => ({ userId: u.userId, role: u.role, studentId: item.studentId }));
    if (!recipients.length && !keepWithoutRecipients) continue;
    findings.push({
      dedupeKey: item.dedupeKey,
      subject: { type: 'student', id: item.studentId },
      params: {
        ...item.params,
        studentId: item.studentId,
        studentName: l.full_name,
        sectionId: l.section_id,
        sectionLabel: l.section_label,
      },
      actionUrl: item.actionUrl,
      expiresAt: item.expiresAt,
      recipients,
    });
  }
  return findings;
}

/**
 * Open fee totals per student whose due date matches `dueSql` (a fragment over
 * `sf.due_date` using `$2`/`$3`). `student_fees` has no tenant_id: scoped through students.
 */
export async function openFeesByStudent(
  ds: DataSource,
  tenantId: string,
  dueSql: string,
  args: string[],
): Promise<{ student_id: string; amount: string; first_due: string; last_due: string }[]> {
  return ds.query(
    `SELECT sf.student_id,
            SUM(sf.total_amount - sf.paid_amount - sf.discount_amount)::numeric AS amount,
            to_char(MIN(sf.due_date), 'YYYY-MM-DD') AS first_due,
            to_char(MAX(sf.due_date), 'YYYY-MM-DD') AS last_due
     FROM student_fees sf
     JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL
     WHERE sf.deleted_at IS NULL AND sf.status IN ('PENDING','PARTIALLY_PAID') AND ${dueSql}
     GROUP BY sf.student_id`,
    [tenantId, ...args],
  );
}
