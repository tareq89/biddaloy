import { EntityManager } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import { Enrollment } from '../students/entities/enrollment.entity';

/**
 * Student ids enrolled in a section, for that section's OWN academic year
 * (a section belongs to exactly one class and one year, so `section_id`
 * alone pins both). Independent of `Student.class_section_id`, which is
 * the student's CURRENT placement and moves on promotion. Same rule as
 * the mark grid (Epic 19 D17). Ordered by roll number.
 *
 * Every enrollment status counts by default: a student who left or graduated
 * after the exam is still in the results cohort (`loadExamCohort`), so must
 * stay here. Attendance passes `excludeLeft` (#2269): a student whose
 * enrollment here ended INACTIVE or TRANSFERRED left the section, so is off
 * its register and summaries. GRADUATED still counts: they finished the year.
 *
 * ponytail: an in-place section move rewrites `enrollments.section_id`, so
 * a mid-year move is not date-aware; that needs enrollment history (#2133
 * item 18).
 */
export async function sectionRosterStudentIds(
  manager: EntityManager,
  tenantId: string,
  sectionId: string,
  opts: { excludeLeft?: boolean } = {},
): Promise<string[]> {
  const qb = manager
    .getRepository(Enrollment)
    .createQueryBuilder('e')
    .innerJoin(
      'students',
      'st',
      'st.id = e.student_id AND st.tenant_id = e.tenant_id AND st.deleted_at IS NULL',
    )
    .select('e.student_id', 'student_id')
    .where('e.tenant_id = :tenantId', { tenantId })
    .andWhere('e.section_id = :sectionId', { sectionId });
  if (opts.excludeLeft) {
    qb.andWhere('e.enrollment_status IN (:...stayed)', {
      stayed: [EnrollmentStatus.ACTIVE, EnrollmentStatus.GRADUATED],
    });
  }
  const rows = await qb.orderBy('st.roll_number', 'ASC').getRawMany<{ student_id: string }>();
  return rows.map((r) => r.student_id);
}
