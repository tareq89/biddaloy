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
 * ponytail: an in-place section move rewrites `enrollments.section_id`, so
 * a mid-year move is not date-aware; that needs enrollment history (#2133
 * item 18).
 */
export async function sectionRosterStudentIds(
  manager: EntityManager,
  tenantId: string,
  sectionId: string,
  opts: { activeOnly: boolean },
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
    .andWhere('e.section_id = :sectionId', { sectionId })
    .orderBy('st.roll_number', 'ASC');
  if (opts.activeOnly) {
    qb.andWhere('e.enrollment_status = :status', { status: EnrollmentStatus.ACTIVE });
  }
  return (await qb.getRawMany<{ student_id: string }>()).map((r) => r.student_id);
}
