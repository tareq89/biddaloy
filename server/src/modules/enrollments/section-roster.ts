import { EntityManager } from 'typeorm';
import { EnrollmentStatus, StudentLifecycleEventType } from '@biddaloy/shared';
import { Enrollment } from '../students/entities/enrollment.entity';

/**
 * Student ids enrolled in each of `sectionIds`, for that section's OWN
 * academic year (a section belongs to exactly one class and one year, so
 * `section_id` alone pins both). Independent of `Student.class_section_id`,
 * which is the student's CURRENT placement and moves on promotion. Same rule
 * as the mark grid (Epic 19 D17). Ordered by roll number inside each section.
 *
 * No opts = every status: a student who left or graduated after the exam is
 * still in the results cohort (`loadExamCohort`), so must stay there.
 *
 * `onRollOn` (YYYY-MM-DD, attendance) = who is on the roll on that date: the
 * enrollment is ACTIVE, or its latest leaving event is dated AFTER the date.
 * Rahim leaves on 3 Oct: on the roll 2 Oct, off it 3 Oct and later. An ended
 * enrollment with no leaving event is off on every date.
 *
 * ponytail: an in-place section move rewrites `enrollments.section_id`, so
 * a mid-year move is not date-aware; that needs enrollment history (#2133
 * item 18).
 * ponytail: left, readmitted, then left again counts as on the roll for the
 * gap in between; upgrade path is reading the event sequence.
 */
export async function sectionRosterIdsBySection(
  manager: EntityManager,
  tenantId: string,
  sectionIds: string[],
  opts: { onRollOn?: string } = {},
): Promise<Map<string, string[]>> {
  const bySection = new Map<string, string[]>();
  if (sectionIds.length === 0) return bySection;
  const qb = manager
    .getRepository(Enrollment)
    .createQueryBuilder('e')
    .innerJoin(
      'students',
      'st',
      'st.id = e.student_id AND st.tenant_id = e.tenant_id AND st.deleted_at IS NULL',
    )
    .select('e.student_id', 'student_id')
    .addSelect('e.section_id', 'section_id')
    .where('e.tenant_id = :tenantId', { tenantId })
    .andWhere('e.section_id IN (:...sectionIds)', { sectionIds });
  if (opts.onRollOn) {
    qb.andWhere(
      `(e.enrollment_status = :onRollActive OR (
        SELECT MAX(le.occurred_on) FROM student_lifecycle_events le
        WHERE le.tenant_id = e.tenant_id AND le.student_id = e.student_id
          AND le.enrollment_id = e.id AND le.event_type <> :onRollReadmitted
      ) > :onRollOn)`,
      {
        onRollActive: EnrollmentStatus.ACTIVE,
        onRollReadmitted: StudentLifecycleEventType.READMITTED,
        onRollOn: opts.onRollOn,
      },
    );
  }
  const rows = await qb
    .orderBy('st.roll_number', 'ASC')
    .getRawMany<{ student_id: string; section_id: string }>();
  for (const r of rows) {
    const list = bySection.get(r.section_id) ?? [];
    list.push(r.student_id);
    bySection.set(r.section_id, list);
  }
  return bySection;
}

/** One section's roster; see {@link sectionRosterIdsBySection}. */
export async function sectionRosterStudentIds(
  manager: EntityManager,
  tenantId: string,
  sectionId: string,
  opts: { onRollOn?: string } = {},
): Promise<string[]> {
  return (
    (await sectionRosterIdsBySection(manager, tenantId, [sectionId], opts)).get(sectionId) ?? []
  );
}
