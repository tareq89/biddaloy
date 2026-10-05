import { EntityManager } from 'typeorm';
import { FineTriggerEvaluator } from './fine-trigger';

interface CountRow {
  student_id: string;
  class_id: string;
  count: string;
}

/**
 * [38.2.3] Counts `LATE` days per student in `[from, to]`, tenant-scoped,
 * excluding `nonWorkingDates`. `conditions.min_minutes_late` (from the
 * `FineRule`) only applies when `ar.minutes_late IS NOT NULL` (D23) — a
 * LATE record with a null `minutes_late` always counts, regardless of the
 * threshold. Class resolution mirrors the absent trigger (D21/D22).
 */
export const attendanceLateTrigger: FineTriggerEvaluator = {
  async count(manager, tenantId, from, to, conditions, scope, nonWorkingDates) {
    const minMinutesLate =
      typeof conditions.min_minutes_late === 'number' ? conditions.min_minutes_late : 0;
    const rows = (await manager.query(
      `WITH filtered AS (
         SELECT ar.student_id, ar.date, cs.class_id
           FROM attendance_records ar
           JOIN attendance_sessions s ON s.id = ar.session_id
           JOIN class_sections cs ON cs.id = s.section_id
           JOIN students st ON st.id = ar.student_id
          WHERE ar.tenant_id = $1
            AND ar.date BETWEEN $2 AND $3
            AND s.period_no IS NULL
            AND ar.status = 'LATE'
            AND ar.date <> ALL($4::date[])
            AND ($5::uuid IS NULL OR cs.class_id = $5)
            AND ($6::uuid IS NULL OR s.section_id = $6)
            AND (ar.minutes_late IS NULL OR ar.minutes_late >= $7)
            AND st.deleted_at IS NULL
       )
       SELECT DISTINCT ON (student_id) student_id, class_id,
              COUNT(*) OVER (PARTITION BY student_id) AS count
         FROM filtered
        ORDER BY student_id, date DESC`,
      [
        tenantId,
        from,
        to,
        nonWorkingDates,
        scope.classId ?? null,
        scope.sectionId ?? null,
        minMinutesLate,
      ],
    )) as CountRow[];

    const result = new Map<string, { count: number; classId: string }>();
    for (const row of rows) {
      result.set(row.student_id, { count: Number(row.count), classId: row.class_id });
    }
    return result;
  },
};
