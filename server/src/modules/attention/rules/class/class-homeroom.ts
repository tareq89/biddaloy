import { UserRole } from '@biddaloy/shared';
import type { DataSource } from 'typeorm';

export interface HomeroomSection {
  sectionLabel: string;
  recipients: { userId: string; role: UserRole }[];
}

/**
 * Current-year class / assistant class teachers for the whole tenant, grouped
 * by section. One query per run (mirrors TeacherScopeService.homeroomSections).
 */
export async function loadHomeroomSections(
  dataSource: DataSource,
  tenantId: string,
): Promise<Map<string, HomeroomSection>> {
  const rows: { sectionId: string; userId: string; sectionLabel: string }[] =
    await dataSource.query(
      `SELECT DISTINCT tcs.section_id AS "sectionId", t.user_id AS "userId",
              c.name || '-' || cs.section_name AS "sectionLabel"
       FROM teacher_class_sections tcs
       JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
       JOIN users u ON u.id = t.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       JOIN class_sections cs ON cs.id = tcs.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
       JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
            AND ay.is_current = true AND ay.deleted_at IS NULL
       WHERE tcs.tenant_id = $1
         AND tcs.assignment_type IN ('CLASS_TEACHER', 'ASSISTANT_CLASS_TEACHER')`,
      [tenantId],
    );
  const out = new Map<string, HomeroomSection>();
  for (const r of rows) {
    const s = out.get(r.sectionId) ?? { sectionLabel: r.sectionLabel, recipients: [] };
    s.recipients.push({ userId: r.userId, role: UserRole.TEACHER });
    out.set(r.sectionId, s);
  }
  return out;
}
