import type { EntityManager } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ADMIT_CARD_SITTING_SLOTS, DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, PrintContext, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

export interface SittingSchedule {
  id: string;
  subject: string;
  /** ISO YYYY-MM-DD */
  date: string;
  /** HH:MM */
  starts_at: string;
  /** HH:MM */
  ends_at: string;
}

export interface SittingAllocation {
  exam_schedule_id: string;
  room: string;
  seat: string;
}

/**
 * The `exam.sitting.N.*` slots and the `seat.*` header for one student.
 * `allocations` are the student's allocations in a PUBLISHED plan; when there
 * are any, only those sittings are listed (optional subjects drop out).
 */
export function buildSittingValues(
  schedules: SittingSchedule[],
  allocations: SittingAllocation[],
): Record<string, string> {
  const allocBySitting = new Map(allocations.map((a) => [a.exam_schedule_id, a]));
  const listed = (
    allocBySitting.size ? schedules.filter((s) => allocBySitting.has(s.id)) : schedules
  )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.starts_at.localeCompare(b.starts_at));
  if (listed.length > ADMIT_CARD_SITTING_SLOTS) {
    throw new ConflictException({
      message: 'This exam has more sittings than an admit card can show',
      details: { code: 'TOO_MANY_SITTINGS', max: ADMIT_CARD_SITTING_SLOTS },
    });
  }
  const values: Record<string, string> = {};
  const rooms = new Set<string>();
  const seats = new Set<string>();
  listed.forEach((s, i) => {
    const a = allocBySitting.get(s.id);
    const n = i + 1;
    rooms.add(a?.room ?? '');
    seats.add(a?.seat ?? '');
    values[`exam.sitting.${n}.subject`] = s.subject;
    values[`exam.sitting.${n}.date`] = s.date;
    values[`exam.sitting.${n}.time`] = `${s.starts_at}–${s.ends_at}`;
    values[`exam.sitting.${n}.room`] = a?.room ?? '';
    values[`exam.sitting.${n}.seat`] = a?.seat ?? '';
  });
  // D35: header only when every listed sitting agrees.
  values['seat.room'] = rooms.size === 1 ? [...rooms][0] : '';
  values['seat.number'] = seats.size === 1 ? [...seats][0] : '';
  return values;
}

interface StudentRow {
  id: string;
  full_name: string;
  full_name_bn: string | null;
  father_name: string | null;
  mother_name: string | null;
  birth_reg_no: string | null;
  registration_number: string;
  roll_number: number | null;
  dob: string | null;
  photo_key: string | null;
  class_name: string | null;
  section_name: string | null;
}

/** Admit-card values for students of the exam's class (context = the exam). */
export class AdmitCardResolver implements FieldResolver {
  kind = DocumentKind.EXAM_ADMIT_CARD;
  subjectType = 'STUDENT' as const;

  async resolve(
    tenantId: string,
    subjectIds: string[],
    manager: EntityManager,
    _callerId?: string,
    context?: PrintContext,
  ) {
    if (context?.type !== 'EXAM') throw new BadRequestException('Admit cards need an exam');

    const [exam] = await manager.query(
      `SELECT e.id, e.name, e.class_id, e.academic_year_id, ay.name AS year_name
         FROM exams e JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
      [tenantId, context.id],
    );
    if (!exam) throw new NotFoundException('Exam not found');

    const students: StudentRow[] = await manager.query(
      `SELECT s.id, s.full_name, s.full_name_bn, s.father_name, s.mother_name, s.birth_reg_no,
              s.registration_number, s.roll_number, to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob,
              s.photo_key, c.name AS class_name, cs.section_name
         FROM students s
         JOIN enrollments e ON e.student_id = s.id AND e.tenant_id = s.tenant_id
          AND e.enrollment_status = 'ACTIVE' AND e.class_id = $3 AND e.academic_year_id = $4
         JOIN classes c ON c.id = e.class_id AND c.tenant_id = s.tenant_id
         LEFT JOIN class_sections cs ON cs.id = e.section_id AND cs.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.id = ANY($2::uuid[])`,
      [tenantId, subjectIds, exam.class_id, exam.academic_year_id],
    );
    if (!students.length) return new Map<string, ResolvedSubject>();

    const schedules: SittingSchedule[] = await manager.query(
      `SELECT es.id, sub.name_en AS subject, to_char(es.date, 'YYYY-MM-DD') AS date,
              to_char(es.starts_at, 'HH24:MI') AS starts_at, to_char(es.ends_at, 'HH24:MI') AS ends_at
         FROM exam_schedules es JOIN subjects sub ON sub.id = es.subject_id
        WHERE es.tenant_id = $1 AND es.exam_id = $2 AND es.deleted_at IS NULL
        ORDER BY es.date, es.starts_at`,
      [tenantId, exam.id],
    );
    const allocRows: (SittingAllocation & { student_id: string })[] = await manager.query(
      `SELECT sa.student_id, sa.exam_schedule_id, sa.seat_number AS seat,
              btrim(concat_ws(' ', r.building, r.room_no)) AS room
         FROM seat_allocations sa
         JOIN seat_plans sp ON sp.id = sa.seat_plan_id AND sp.tenant_id = sa.tenant_id
          AND sp.status = 'PUBLISHED' AND sp.deleted_at IS NULL
         JOIN rooms r ON r.id = sa.room_id AND r.tenant_id = sa.tenant_id
        WHERE sa.tenant_id = $1 AND sa.student_id = ANY($2::uuid[])
          AND sa.exam_schedule_id = ANY($3::uuid[])`,
      [tenantId, students.map((s) => s.id), schedules.map((s) => s.id)],
    );
    const byStudent = new Map<string, SittingAllocation[]>();
    for (const a of allocRows) {
      const list = byStudent.get(a.student_id) ?? [];
      list.push(a);
      byStudent.set(a.student_id, list);
    }

    const school = await schoolValues(tenantId, manager);
    const out = new Map<string, ResolvedSubject>();
    for (const r of students) {
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
          'exam.name': exam.name,
          'exam.year': exam.year_name,
          ...buildSittingValues(schedules, byStudent.get(r.id) ?? []),
        },
      });
    }
    return out;
  }
}
