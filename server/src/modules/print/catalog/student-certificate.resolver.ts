import type { EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { DocumentKind, StudentLifecycleEventType } from '@biddaloy/shared';
import type { FieldResolver, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

export type StudentCertificateKind =
  | typeof DocumentKind.TRANSFER_CERTIFICATE
  | typeof DocumentKind.TESTIMONIAL
  | typeof DocumentKind.CHARACTER_CERTIFICATE
  | typeof DocumentKind.STUDY_CERTIFICATE
  | typeof DocumentKind.PARTICIPATION_CERTIFICATE;

type Reason = 'NO_LEAVING_EVENT' | 'NOT_CURRENT_OR_GRADUATED' | 'NOT_CURRENT';

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
  enrollment_status: string;
  class_name: string | null;
  section_name: string | null;
  admission_date: string | null;
  academic_year: string | null;
}
interface LeaveRow {
  student_id: string;
  event_type: string;
  occurred_on: string;
  reason: string;
  destination: string | null;
  class_name: string | null;
}
interface ExamRow {
  student_id: string;
  exam_type: string;
  board: string;
  roll_no: string;
  registration_no: string;
  gpa: string | null;
  passing_year: number;
}

const LEAVING: string[] = [
  StudentLifecycleEventType.TRANSFERRED_OUT,
  StudentLifecycleEventType.WITHDRAWN,
];

/** One resolver class, one instance per certificate kind (D3). */
export class StudentCertificateResolver implements FieldResolver {
  subjectType = 'STUDENT' as const;

  constructor(readonly kind: StudentCertificateKind) {}

  async resolve(tenantId: string, subjectIds: string[], manager: EntityManager) {
    const rows: Row[] = await manager.query(
      `SELECT s.id, s.full_name, s.full_name_bn, s.registration_number, s.roll_number,
              s.father_name, s.mother_name, s.birth_reg_no,
              to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, s.photo_key, s.enrollment_status,
              c.name AS class_name, cs.section_name,
              (SELECT to_char(min(e0.enrolled_at), 'YYYY-MM-DD') FROM enrollments e0
                WHERE e0.student_id = s.id AND e0.tenant_id = s.tenant_id) AS admission_date,
              e.year_name AS academic_year
         FROM students s
         LEFT JOIN LATERAL (
           SELECT e2.class_id, e2.section_id, ay2.name AS year_name
             FROM enrollments e2
             JOIN academic_years ay2 ON ay2.id = e2.academic_year_id AND ay2.tenant_id = e2.tenant_id
            WHERE e2.student_id = s.id AND e2.tenant_id = s.tenant_id
              AND e2.enrollment_status = 'ACTIVE'
            ORDER BY ay2.is_current DESC, e2.enrolled_at DESC, e2.id LIMIT 1) e ON true
         LEFT JOIN classes c ON c.id = e.class_id AND c.tenant_id = s.tenant_id
         LEFT JOIN class_sections cs ON cs.id = e.section_id AND cs.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.id = ANY($2::uuid[])`,
      [tenantId, subjectIds],
    );
    const ids = rows.map((r) => r.id);

    const leaves = new Map<string, LeaveRow>();
    if (this.kind === DocumentKind.TRANSFER_CERTIFICATE && ids.length) {
      const l: LeaveRow[] = await manager.query(
        `SELECT DISTINCT ON (ev.student_id) ev.student_id, ev.event_type,
                to_char(ev.occurred_on, 'YYYY-MM-DD') AS occurred_on, ev.reason, ev.destination,
                c.name AS class_name
           FROM student_lifecycle_events ev
           LEFT JOIN enrollments en ON en.id = ev.enrollment_id AND en.tenant_id = ev.tenant_id
           LEFT JOIN classes c ON c.id = en.class_id AND c.tenant_id = ev.tenant_id
          WHERE ev.tenant_id = $1 AND ev.student_id = ANY($2::uuid[])
          ORDER BY ev.student_id, ev.occurred_on DESC, ev.created_at DESC`,
        [tenantId, ids],
      );
      for (const r of l) leaves.set(r.student_id, r);
    }
    const exams = new Map<string, ExamRow>();
    if (this.kind === DocumentKind.TESTIMONIAL && ids.length) {
      const x: ExamRow[] = await manager.query(
        `SELECT DISTINCT ON (student_id) student_id, exam_type, board, roll_no, registration_no,
                gpa, passing_year
           FROM student_public_exams
          WHERE tenant_id = $1 AND student_id = ANY($2::uuid[]) AND deleted_at IS NULL
          ORDER BY student_id, passing_year DESC, created_at DESC`,
        [tenantId, ids],
      );
      for (const r of x) exams.set(r.student_id, r);
    }

    const refused: { id: string; reason: Reason }[] = [];
    for (const r of rows) {
      const reason = this.refusal(r, leaves.get(r.id));
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
      const extra: Record<string, string> = {};
      const leave = leaves.get(r.id);
      const exam = exams.get(r.id);
      if (this.kind === DocumentKind.TRANSFER_CERTIFICATE && leave) {
        extra['student.admission_date'] = r.admission_date ?? '';
        extra['leaving.date'] = leave.occurred_on;
        extra['leaving.reason'] = leave.reason;
        extra['leaving.destination'] = leave.destination ?? '';
        extra['leaving.class'] = leave.class_name ?? '';
      }
      if (this.kind === DocumentKind.STUDY_CERTIFICATE) {
        extra['student.admission_date'] = r.admission_date ?? '';
        extra['student.academic_year'] = r.academic_year ?? '';
      }
      if (exam) {
        extra['public_exam.name'] = exam.exam_type;
        extra['public_exam.board'] = exam.board;
        extra['public_exam.roll'] = exam.roll_no;
        extra['public_exam.registration'] = exam.registration_no;
        extra['public_exam.gpa'] = exam.gpa ?? '';
        extra['public_exam.year'] = String(exam.passing_year);
      }
      out.set(r.id, {
        label: r.full_name,
        photoKey: r.photo_key,
        values: {
          ...blankValues(this.kind),
          ...school,
          'student.name': r.full_name,
          'student.name_bn': r.full_name_bn || r.full_name,
          'student.father_name': r.father_name ?? '',
          'student.mother_name': r.mother_name ?? '',
          'student.class': r.class_name ?? '',
          'student.section': r.section_name ?? '',
          'student.roll': r.roll_number == null ? '' : String(r.roll_number),
          'student.registration_number': r.registration_number,
          'student.date_of_birth': r.dob ?? '',
          'student.birth_reg_no': r.birth_reg_no ?? '',
          ...extra,
        },
      });
    }
    return out;
  }

  /** D4 / D42: why this student cannot get this certificate, or null. */
  private refusal(r: Row, leave?: LeaveRow): Reason | null {
    switch (this.kind) {
      case DocumentKind.TRANSFER_CERTIFICATE:
        return leave && LEAVING.includes(leave.event_type) ? null : 'NO_LEAVING_EVENT';
      case DocumentKind.TESTIMONIAL:
        return ['ACTIVE', 'GRADUATED'].includes(r.enrollment_status)
          ? null
          : 'NOT_CURRENT_OR_GRADUATED';
      case DocumentKind.STUDY_CERTIFICATE:
        return r.enrollment_status === 'ACTIVE' ? null : 'NOT_CURRENT';
      default:
        return null;
    }
  }
}
