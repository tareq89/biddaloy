import { EntityManager, In, IsNull } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { ClassSection } from '../academics/entities/class-section.entity';

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

/** One student of the exam's cohort and the section they sat it in. */
export type CohortMember = Pick<Enrollment, 'student_id' | 'section_id' | 'section'>;

/**
 * Who is in this exam: the students who sat it, not who is enrolled today.
 * D17: keyed by the exam's own (academic_year_id, class_id) enrollments, not
 * `Student.class_section_id`.
 *
 * - ACTIVE enrollment: in, unless they joined after the last sitting and
 *   have no Mark row and no live Result. `enrolled_at` is not a reliable
 *   join date (the 1789800015000 backfill and any mid-year import stamp
 *   now()), so it can keep a row from being written but never removes one.
 * - Any other status (left, graduated, inactive): in only with a Mark row.
 *   A Result alone is not proof they sat it — results used to be written
 *   ABSENT/FAIL for every ACTIVE student, marks or not.
 * - A Mark row but no enrollment in this class/year at all (class moved in
 *   place): in, in the section of their existing result.
 *
 * Everyone else is out, and `replaceResults` removes their old row.
 */
export async function loadExamCohort(
  manager: EntityManager,
  exam: Exam,
  tenantId: string,
): Promise<{ members: CohortMember[]; studentsWithResult: Set<string> }> {
  const [results, marks, scheduled] = await Promise.all([
    manager
      .getRepository(Result)
      .find({ where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() } }),
    manager
      .getRepository(Mark)
      .createQueryBuilder('m')
      .select('m.student_id', 'student_id')
      .addSelect('MIN(m.created_at)', 'first_mark_at')
      .where('m.exam_id = :examId AND m.tenant_id = :tenantId', { examId: exam.id, tenantId })
      .groupBy('m.student_id')
      .getRawMany<{ student_id: string; first_mark_at: Date }>(),
    lastSittingDate(manager, exam, tenantId),
  ]);
  const studentsWithResult = new Set(results.map((r) => r.student_id));
  const resultSection = new Map(results.map((r) => [r.student_id, r.section_id]));
  const studentsWithMark = new Set(marks.map((m) => m.student_id));

  // No schedule and no term: the sitting date is unknown. Marks are only
  // ever written after the sitting, so the first mark write is a safe
  // stand-in — anyone enrolled after that day joined late and needs marks
  // of their own. created_at, not updated_at: a grid re-save must not move it.
  // No marks at all: nobody can be told apart, so nobody is late.
  const firstMarkAt = marks.reduce<number | null>((min, m) => {
    const t = new Date(m.first_mark_at).getTime();
    return min === null || t < min ? t : min;
  }, null);
  const lastSitting =
    scheduled ?? (firstMarkAt === null ? null : new Date(firstMarkAt).toISOString().slice(0, 10));

  const all = await manager.getRepository(Enrollment).find({
    where: {
      tenant_id: tenantId,
      academic_year_id: exam.academic_year_id,
      class_id: exam.class_id,
    },
    // [35.1.14] section join gives the stream (group_name).
    relations: { section: true },
  });

  // Known gap (#2215 m7): a truly absent student enrolled after the last
  // sitting whose cells were left blank (no Mark row) gets no result, not ABS/FAIL.
  const kept = all.filter((e) =>
    e.enrollment_status === EnrollmentStatus.ACTIVE
      ? !joinedAfterExam(e.enrolled_at, lastSitting) ||
        studentsWithMark.has(e.student_id) ||
        studentsWithResult.has(e.student_id)
      : studentsWithMark.has(e.student_id),
  );

  // One enrollment per student: the one in the section of their existing
  // result, then ACTIVE, then the most recently updated.
  const inResultSection = (e: Enrollment) =>
    e.section_id !== null && e.section_id === resultSection.get(e.student_id);
  kept.sort(
    (a, b) =>
      Number(inResultSection(b)) - Number(inResultSection(a)) ||
      Number(b.enrollment_status === EnrollmentStatus.ACTIVE) -
        Number(a.enrollment_status === EnrollmentStatus.ACTIVE) ||
      b.updated_at.getTime() - a.updated_at.getTime(),
  );
  const members = new Map<string, CohortMember>();
  for (const e of kept) if (!members.has(e.student_id)) members.set(e.student_id, e);

  // Marks but no enrollment in this class/year (moved class in place):
  // recomputed in the section of their existing result, so they are ranked
  // with everyone else instead of keeping a stale position.
  const enrolled = new Set(all.map((e) => e.student_id));
  const moved = [...studentsWithMark].filter((id) => !enrolled.has(id));
  const sectionIds = [
    ...new Set(moved.map((id) => resultSection.get(id)).filter((s): s is string => !!s)),
  ];
  const sections =
    sectionIds.length === 0
      ? []
      : await manager
          .getRepository(ClassSection)
          .find({ where: { id: In(sectionIds), tenant_id: tenantId } });
  for (const id of moved) {
    const sectionId = resultSection.get(id) ?? null;
    members.set(id, {
      student_id: id,
      section_id: sectionId,
      section: sections.find((s) => s.id === sectionId) ?? null,
    });
  }
  return { members: [...members.values()], studentsWithResult };
}
