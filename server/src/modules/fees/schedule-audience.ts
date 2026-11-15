import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** [F-141, #2714] The one class/section audience rule of a recurring schedule, shared by the
 * daily scheduler, `preview` and `findForStudent`. Promotion leaves the old-year enrollment
 * ACTIVE and only moves `students.class_section_id`, so a student is matched on their ACTIVE
 * enrollment in the schedule's own year; with no such enrollment it falls back to today's
 * columns. `qb` must alias the `Student` query as `'s'` and its joined section as `'cs'`. */
export function applyScheduleClassAudience<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  audience: { class_id?: string | null; section_id?: string | null },
  academicYearId: string,
): void {
  qb.leftJoin(
    'enrollments',
    'e',
    'e.student_id = s.id AND e.tenant_id = s.tenant_id AND e.academic_year_id = :yearId AND e.enrollment_status = :enrolStatus',
    { yearId: academicYearId, enrolStatus: 'ACTIVE' },
  );
  if (audience.section_id) {
    qb.andWhere(
      'CASE WHEN e.id IS NOT NULL THEN e.section_id ELSE s.class_section_id END = :sectionId',
      { sectionId: audience.section_id },
    );
  } else if (audience.class_id) {
    qb.andWhere('CASE WHEN e.id IS NOT NULL THEN e.class_id ELSE cs.class_id END = :classId', {
      classId: audience.class_id,
    });
  }
}
