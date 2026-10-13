import { DataSource } from 'typeorm';
import { Enrollment } from '../../src/modules/students/entities/enrollment.entity';
import { ClassSection } from '../../src/modules/academics/entities/class-section.entity';
import { Class } from '../../src/modules/academics/entities/class.entity';

/**
 * Test fixture: give a student the ACTIVE enrollment that production creates
 * on admission, so section rosters (enrollment-based) include them.
 * Pass `sectionId` to enrol in a section other than the student's placement.
 */
export async function enrollStudent(
  ds: DataSource,
  student: { id: string; tenant_id: string; class_section_id: string },
  sectionId: string = student.class_section_id,
): Promise<Enrollment> {
  const section = await ds
    .getRepository(ClassSection)
    .findOneOrFail({ where: { id: sectionId, tenant_id: student.tenant_id } });
  const klass = await ds.getRepository(Class).findOneOrFail({ where: { id: section.class_id } });
  return ds.getRepository(Enrollment).save({
    student_id: student.id,
    class_id: section.class_id,
    section_id: sectionId,
    academic_year_id: klass.academic_year_id,
    tenant_id: student.tenant_id,
  });
}

/**
 * Test fixture for specs that seed students with raw SQL or in bulk: give
 * every student of the tenant who has no enrollment for their placed
 * section's year an ACTIVE one. Idempotent, so call it after each seeding step.
 */
export async function enrollPlacedStudents(ds: DataSource, tenantId?: string): Promise<void> {
  await ds.query(
    `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status)
     SELECT st.id, cs.class_id, cs.id, c.academic_year_id, st.tenant_id, 'ACTIVE'
       FROM students st
       JOIN class_sections cs ON cs.id = st.class_section_id
       JOIN classes c ON c.id = cs.class_id
      WHERE ($1::uuid IS NULL OR st.tenant_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e
           WHERE e.student_id = st.id AND e.academic_year_id = c.academic_year_id
             AND e.enrollment_status = 'ACTIVE'
        )`,
    [tenantId ?? null],
  );
}
