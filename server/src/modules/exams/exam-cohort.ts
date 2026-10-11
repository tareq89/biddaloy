import { EntityManager, IsNull } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Latest sitting date (YYYY-MM-DD) of the exam: its newest live schedule
 * row, else the linked term's end date, else null. */
export async function lastSittingDate(
  manager: EntityManager,
  exam: Exam,
  tenantId: string,
): Promise<string | null> {
  const row = await manager
    .getRepository(ExamSchedule)
    .createQueryBuilder('s')
    .select(`to_char(MAX(s.date), 'YYYY-MM-DD')`, 'max')
    .where('s.exam_id = :examId AND s.tenant_id = :tenantId AND s.deleted_at IS NULL', {
      examId: exam.id,
      tenantId,
    })
    .getRawOne<{ max: string | null }>();
  if (row?.max) return row.max;
  if (!exam.academic_term_id) return null;
  const term = await manager.getRepository(AcademicTerm).findOne({
    where: { id: exam.academic_term_id, tenant_id: tenantId, deleted_at: IsNull() },
  });
  return term?.end_date ?? null;
}

/** True when the enrollment started after the last sitting. Whole-day
 * comparison in UTC; a few hours of time-zone slop only ever keeps a
 * student in, never drops one. */
export function joinedAfterExam(enrolledAt: Date, lastSitting: string | null): boolean {
  if (!lastSitting) return false;
  const nextDay = new Date(`${lastSitting}T00:00:00Z`).getTime() + DAY_MS;
  return enrolledAt.getTime() >= nextDay;
}

/**
 * Who is in this exam: the students who sat it, not who is enrolled today.
 * D17: keyed by the exam's own (academic_year_id, class_id) enrollments, not
 * `Student.class_section_id`. A student who left/graduated since keeps their
 * result (they have a live Result or Mark row); one who joined after the
 * last sitting and has no marks is left out.
 */
export async function loadExamCohort(
  manager: EntityManager,
  exam: Exam,
  tenantId: string,
): Promise<{ enrollments: Enrollment[]; studentsWithResult: Set<string> }> {
  const [results, marks, lastSitting] = await Promise.all([
    manager
      .getRepository(Result)
      .find({ where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() } }),
    manager
      .getRepository(Mark)
      .createQueryBuilder('m')
      .select('DISTINCT m.student_id', 'student_id')
      .where('m.exam_id = :examId AND m.tenant_id = :tenantId', { examId: exam.id, tenantId })
      .getRawMany<{ student_id: string }>(),
    lastSittingDate(manager, exam, tenantId),
  ]);
  const studentsWithResult = new Set(results.map((r) => r.student_id));
  const studentsWithMark = new Set(marks.map((m) => m.student_id));

  const all = await manager.getRepository(Enrollment).find({
    where: {
      tenant_id: tenantId,
      academic_year_id: exam.academic_year_id,
      class_id: exam.class_id,
    },
    // [35.1.14] section join gives the stream (group_name).
    relations: { section: true },
  });

  const kept = all.filter((e) =>
    e.enrollment_status === EnrollmentStatus.ACTIVE
      ? !joinedAfterExam(e.enrolled_at, lastSitting) || studentsWithMark.has(e.student_id)
      : studentsWithResult.has(e.student_id) || studentsWithMark.has(e.student_id),
  );

  // One enrollment per student: ACTIVE wins, else the most recently updated.
  const best = new Map<string, Enrollment>();
  for (const e of kept) {
    const cur = best.get(e.student_id);
    const better =
      !cur ||
      (cur.enrollment_status !== EnrollmentStatus.ACTIVE &&
        (e.enrollment_status === EnrollmentStatus.ACTIVE ||
          e.updated_at.getTime() > cur.updated_at.getTime()));
    if (better) best.set(e.student_id, e);
  }
  return { enrollments: [...best.values()], studentsWithResult };
}
