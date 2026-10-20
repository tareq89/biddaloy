import { In, type EntityManager } from 'typeorm';
import { ClassSubject } from './entities/class-subject.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';

/**
 * [2675/2676] Parent remove() hides the subject offerings of a class or year
 * the same way SubjectService.remove does: delete the students' choices of
 * those offerings, then soft-delete the offerings.
 */
export async function dropClassSubjects(
  manager: EntityManager,
  tenantId: string,
  by: { class_id: string } | { academic_year_id: string },
): Promise<void> {
  const offerings = await manager.find(ClassSubject, {
    where: { ...by, tenant_id: tenantId },
    select: { id: true },
  });
  if (offerings.length === 0) return;
  await manager.delete(StudentSubjectChoice, {
    class_subject_id: In(offerings.map((o) => o.id)),
    tenant_id: tenantId,
  });
  await manager.softDelete(ClassSubject, { id: In(offerings.map((o) => o.id)) });
}
