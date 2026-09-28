import { EntityManager } from 'typeorm';
import { FineTriggerEvaluator } from './fine-trigger';

interface CountRow {
  student_id: string;
  class_id: string;
  count: string;
}

/**
 * [38.2.3] Counts `ABSENT` days per student in `[from, to]`, tenant-scoped,
 * excluding LEAVE (never counted — not selected by the status filter below)
 * and excluding `nonWorkingDates` (holidays/weekly-off, resolved once by
 * `FineSweepService` via `SchoolCalendarService`). The class used for
 * default-vs-class rule resolution (D22) is the section's class on the
 * student's *latest* absence in range (D21), via `DISTINCT ON`.
 */
export const attendanceAbsentTrigger: FineTriggerEvaluator = {
  async count(manager, tenantId, from, to, _conditions, scope, nonWorkingDates) {
    const rows = (await manager.query(
      `WITH filtered AS (
         SELECT ar.student_id, ar.date, cs.class_id
           FROM attendance_records ar
           JOIN attendance_sessions s ON s.id = ar.session_id
           JOIN class_sections cs ON cs.id = s.section_id
           JOIN students st ON st.id = ar.student_id
          WHERE ar.tenant_id = $1
            AND ar.date BETWEEN $2 AND $3
            AND ar.status = 'ABSENT'
            AND ar.date <> ALL($4::date[])
            AND ($5::uuid IS NULL OR cs.class_id = $5)
            AND ($6::uuid IS NULL OR s.section_id = $6)
            AND st.deleted_at IS NULL
       )
       SELECT DISTINCT ON (student_id) student_id, class_id,
              COUNT(*) OVER (PARTITION BY student_id) AS count
         FROM filtered
        ORDER BY student_id, date DESC`,
      [tenantId, from, to, nonWorkingDates, scope.classId ?? null, scope.sectionId ?? null],
    )) as CountRow[];

    const result = new Map<string, { count: number; classId: string }>();
    for (const row of rows) {
      result.set(row.student_id, { count: Number(row.count), classId: row.class_id });
    }
    return result;
  },
};
