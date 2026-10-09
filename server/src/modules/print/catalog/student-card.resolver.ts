import type { EntityManager } from 'typeorm';
import { DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

interface Row {
  id: string;
  full_name: string;
  full_name_bn: string | null;
  registration_number: string;
  roll_number: number | null;
  blood_group: string | null;
  dob: string | null;
  photo_key: string | null;
  class_name: string | null;
  section_name: string | null;
  valid_until: string | null;
  guardian_phone: string | null;
}

/** One SQL round trip for the whole batch (plus one school lookup). */
export class StudentCardResolver implements FieldResolver {
  kind = DocumentKind.STUDENT_ID_CARD;
  subjectType = 'STUDENT' as const;

  async resolve(tenantId: string, subjectIds: string[], manager: EntityManager) {
    const rows: Row[] = await manager.query(
      `SELECT s.id, s.full_name, s.full_name_bn, s.registration_number, s.roll_number,
              s.blood_group, to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, s.photo_key,
              c.name AS class_name, cs.section_name,
              to_char(e.end_date, 'YYYY-MM-DD') AS valid_until, g.phone AS guardian_phone
         FROM students s
         LEFT JOIN LATERAL (
           SELECT e2.class_id, e2.section_id, ay2.end_date
             FROM enrollments e2
             JOIN academic_years ay2 ON ay2.id = e2.academic_year_id
            WHERE e2.student_id = s.id AND e2.tenant_id = s.tenant_id
              AND e2.enrollment_status = 'ACTIVE'
            ORDER BY ay2.is_current DESC, e2.enrolled_at DESC, e2.id LIMIT 1) e ON true
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN class_sections cs ON cs.id = e.section_id
         LEFT JOIN LATERAL (
           SELECT g2.phone FROM student_guardians sg
             JOIN guardians g2 ON g2.id = sg.guardian_id AND g2.deleted_at IS NULL
            WHERE sg.student_id = s.id
            ORDER BY g2.is_primary_contact DESC, g2.created_at LIMIT 1) g ON true
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.id = ANY($2::uuid[])`,
      [tenantId, subjectIds],
    );
    const school = await schoolValues(tenantId, manager);
    const out = new Map<string, ResolvedSubject>();
    for (const r of rows) {
      out.set(r.id, {
        label: r.full_name,
        photoKey: r.photo_key,
        values: {
          ...blankValues(this.kind),
          ...school,
          'student.name': r.full_name,
          'student.name_bn': r.full_name_bn ?? '',
          'student.class': r.class_name ?? '',
          'student.section': r.section_name ?? '',
          'student.roll': r.roll_number == null ? '' : String(r.roll_number),
          'student.registration_number': r.registration_number,
          'student.blood_group': r.blood_group ?? '',
          'student.date_of_birth': r.dob ?? '',
          'guardian.phone': r.guardian_phone ?? '',
          'card.valid_until': r.valid_until ?? '',
        },
      });
    }
    return out;
  }
}
