import type { EntityManager } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, PrintContext, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

export type ResultCertificateKind =
  typeof DocumentKind.RESULT_CERTIFICATE | typeof DocumentKind.MERIT_CERTIFICATE;

type Reason = 'NOT_PUBLISHED' | 'FAILED' | 'NOT_RANKED';

interface Row {
  id: string;
  full_name: string;
  full_name_bn: string | null;
  registration_number: string;
  roll_number: number | null;
  father_name: string | null;
  mother_name: string | null;
  birth_reg_no: string | null;
  dob: string | null;
  photo_key: string | null;
  class_name: string | null;
  section_name: string | null;
  total_marks: string;
  gpa: string;
  grade: string;
  position: number | null;
  section_position: number | null;
  is_fail: boolean;
  published_at: Date | null;
}

const num = (n: number | null) => (n == null ? '' : String(n));

/** Result / merit certificate values from a published result of one exam (D29). */
export class ResultCertificateResolver implements FieldResolver {
  subjectType = 'STUDENT' as const;

  constructor(readonly kind: ResultCertificateKind) {}

  async resolve(
    tenantId: string,
    subjectIds: string[],
    manager: EntityManager,
    _callerId?: string,
    context?: PrintContext,
  ) {
    if (context?.type !== 'EXAM') throw new BadRequestException('Certificates need an exam');

    const [exam] = await manager.query(
      `SELECT e.id, e.name, ay.name AS year_name
         FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
      [tenantId, context.id],
    );
    if (!exam) throw new NotFoundException('Exam not found');

    // Class/section come from the result's own section, not the live enrollment.
    const rows: Row[] = await manager.query(
      `SELECT s.id, s.full_name, s.full_name_bn, s.registration_number, s.roll_number,
              s.father_name, s.mother_name, s.birth_reg_no,
              to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, s.photo_key,
              c.name AS class_name, cs.section_name,
              r.total_marks, r.gpa, r.grade, r.position, r.section_position, r.is_fail,
              r.published_at
         FROM results r
         JOIN students s ON s.id = r.student_id AND s.tenant_id = r.tenant_id
         LEFT JOIN class_sections cs ON cs.id = r.section_id
         LEFT JOIN classes c ON c.id = cs.class_id
        WHERE r.tenant_id = $1 AND r.exam_id = $2 AND r.student_id = ANY($3::uuid[])
          AND r.deleted_at IS NULL AND s.deleted_at IS NULL`,
      [tenantId, exam.id, subjectIds],
    );

    const refused: { id: string; reason: Reason }[] = [];
    for (const r of rows) {
      const reason = this.refusal(r);
      if (reason) refused.push({ id: r.id, reason });
    }
    if (refused.length) {
      throw new ConflictException({
        message: 'Some students cannot get this certificate',
        details: { code: 'CERTIFICATE_NOT_ELIGIBLE', kind: this.kind, students: refused },
      });
    }

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
          'student.father_name': r.father_name ?? '',
          'student.mother_name': r.mother_name ?? '',
          'student.class': r.class_name ?? '',
          'student.section': r.section_name ?? '',
          'student.roll': num(r.roll_number),
          'student.registration_number': r.registration_number,
          'student.date_of_birth': r.dob ?? '',
          'student.birth_reg_no': r.birth_reg_no ?? '',
          'exam.name': exam.name,
          'exam.year': exam.year_name,
          'result.total_marks': r.total_marks,
          'result.gpa': r.gpa,
          'result.grade': r.grade,
          'result.position': num(r.position),
          // Only the merit catalog has this key.
          ...(this.kind === DocumentKind.MERIT_CERTIFICATE && {
            'result.section_position': num(r.section_position),
          }),
        },
      });
    }
    return out;
  }

  private refusal(r: Row): Reason | null {
    if (!r.published_at) return 'NOT_PUBLISHED';
    if (this.kind === DocumentKind.RESULT_CERTIFICATE) return r.is_fail ? 'FAILED' : null;
    return r.position == null && r.section_position == null ? 'NOT_RANKED' : null;
  }
}
