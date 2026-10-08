import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { LessonDeliveryReason, LessonDeliveryStatus } from '@biddaloy/shared';
import type { StudyPlanExamMarker, StudyPlanLesson } from '@biddaloy/shared';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Class } from '../modules/academics/entities/class.entity';
import type { ClassSection } from '../modules/academics/entities/class-section.entity';
import type { Subject } from '../modules/academics/entities/subject.entity';
import type { AcademicTerm } from '../modules/calendar/entities/academic-term.entity';
import type { Exam } from '../modules/exams/entities/exam.entity';
import type { PeriodSlot } from '../modules/routines/entities/period-slot.entity';
import type { RoutineSlot } from '../modules/routines/entities/routine-slot.entity';
import type { LessonDelivery } from '../modules/study-plans/entities/lesson-delivery.entity';
import type { StudyPlan } from '../modules/study-plans/entities/study-plan.entity';
import type { StudyPlanTemplate } from '../modules/study-plans/entities/study-plan-template.entity';
import type { User } from '../modules/users/entities/user.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Like seed.evaluations.ts: must not import anything that reaches AppModule.

export interface StudyPlansSeedRepositories {
  userRepository: Repository<User>;
  academicYearRepository: Repository<AcademicYear>;
  academicTermRepository: Repository<AcademicTerm>;
  classRepository: Repository<Class>;
  classSectionRepository: Repository<ClassSection>;
  subjectRepository: Repository<Subject>;
  periodSlotRepository: Repository<PeriodSlot>;
  routineSlotRepository: Repository<RoutineSlot>;
  examRepository: Repository<Exam>;
  templateRepository: Repository<StudyPlanTemplate>;
  planRepository: Repository<StudyPlan>;
  deliveryRepository: Repository<LessonDelivery>;
}

export const SEED_TEMPLATE_NAME = 'বোর্ডের বইয়ের ক্রমে';
const TEACHER_EMAIL = 'teacher@biddaloy.test';
const LESSON_TITLES = [
  'প্রথম অধ্যায়: ভূমিকা',
  'দ্বিতীয় অধ্যায়: মূল ধারণা',
  'তৃতীয় অধ্যায়: উদাহরণ',
  'চতুর্থ অধ্যায়: অনুশীলনী',
  'পঞ্চম অধ্যায়: পুনরালোচনা',
  'ষষ্ঠ অধ্যায়: প্রয়োগ',
  'সপ্তম অধ্যায়: সমস্যা সমাধান',
  'অষ্টম অধ্যায়: বিস্তার',
  'নবম অধ্যায়: দলগত কাজ',
  'দশম অধ্যায়: মূল্যায়ন',
  'একাদশ অধ্যায়: সারসংক্ষেপ',
  'দ্বাদশ অধ্যায়: চূড়ান্ত পুনরালোচনা',
];

const templateLessons = (n: number) =>
  LESSON_TITLES.slice(0, n).map((title, i) => ({ id: `t${i + 1}`, title, periods: (i % 2) + 1 }));
const planLessons = (n: number): StudyPlanLesson[] =>
  templateLessons(n).map((l) => ({ ...l, id: randomUUID() }));

/** The `count` most recent dates strictly before `today` that fall on `weekday` (0=Sun). */
function lastWeekdays(today: string, weekday: number, count: number): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() === weekday) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * [66.1.07] Demo rows for Epic 66: one template, two plans (section A, MATH
 * term-scoped then SCI whole-year) and four lesson deliveries on the routine
 * seed's section A slots. Idempotent: every row is found by natural key
 * first. Warns and skips when the demo prerequisites are absent.
 */
export async function ensureStudyPlansSeed(
  repos: StudyPlansSeedRepositories,
  tenantId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const year = await repos.academicYearRepository.findOne({
    where: { tenant_id: tenantId, name: DEMO_ACADEMIC_YEAR.name },
  });
  const cls = year
    ? await repos.classRepository.findOne({
        where: { tenant_id: tenantId, academic_year_id: year.id, name: 'Class 6' },
      })
    : null;
  const section = cls
    ? await repos.classSectionRepository.findOne({
        where: { tenant_id: tenantId, class_id: cls.id, section_name: 'A' },
      })
    : null;
  const math = await repos.subjectRepository.findOne({
    where: { tenant_id: tenantId, code: 'MATH' },
  });
  const sci = await repos.subjectRepository.findOne({
    where: { tenant_id: tenantId, code: 'SCI' },
  });
  const teacherUser = await repos.userRepository.findOne({ where: { email: TEACHER_EMAIL } });
  // The routine seed's plain weekly Monday slot for section A.
  const mondaySlot = section
    ? await repos.routineSlotRepository.findOne({
        where: { tenant_id: tenantId, section_id: section.id, weekday: 1 },
      })
    : null;
  if (!year || !cls || !section || !math || !sci || !teacherUser || !mondaySlot) {
    console.warn('Demo year/class/subjects/teacher/routine not found - skipping study plans seed.');
    return;
  }

  // --- template ----------------------------------------------------------
  const template = await repos.templateRepository.findOne({
    where: { tenant_id: tenantId, name: SEED_TEMPLATE_NAME },
  });
  if (!template) {
    await repos.templateRepository.save(
      repos.templateRepository.create({
        tenant_id: tenantId,
        name: SEED_TEMPLATE_NAME,
        class_grade: cls.numeric_grade ?? 6,
        subject_code: math.code,
        lessons: templateLessons(12),
      }),
    );
  }

  // --- plans ---------------------------------------------------------------
  const term = await repos.academicTermRepository.findOne({
    where: { tenant_id: tenantId, academic_year_id: year.id, seq: 1 },
  });
  const exam = await repos.examRepository.findOne({
    where: { tenant_id: tenantId, academic_year_id: year.id, class_id: cls.id },
  });

  async function ensurePlan(
    subjectId: string,
    termId: string | null,
    lessons: StudyPlanLesson[],
    markers: StudyPlanExamMarker[],
  ): Promise<void> {
    const found = await repos.planRepository.findOne({
      where: { tenant_id: tenantId, section_id: section!.id, subject_id: subjectId },
    });
    if (found) return;
    await repos.planRepository.save(
      repos.planRepository.create({
        tenant_id: tenantId,
        academic_year_id: year!.id,
        academic_term_id: termId,
        section_id: section!.id,
        subject_id: subjectId,
        lessons,
        exam_markers: markers,
      }),
    );
  }

  const mathLessons = planLessons(12);
  await ensurePlan(
    math.id,
    term?.id ?? null,
    mathLessons,
    exam ? [{ exam_id: exam.id, up_to_lesson_id: mathLessons[5]!.id }] : [],
  );
  await ensurePlan(sci.id, null, planLessons(6), []);

  // --- deliveries ------------------------------------------------------------
  const mondays = lastWeekdays(today, 1, 3);
  const [extraDate] = lastWeekdays(today, 2, 1);
  const rows: {
    date: string;
    period_slot_id: string;
    status: LessonDeliveryStatus;
    reason: LessonDeliveryReason | null;
    is_extra: boolean;
  }[] = [
    { status: LessonDeliveryStatus.TAUGHT, reason: null },
    { status: LessonDeliveryStatus.PARTLY, reason: null },
    { status: LessonDeliveryStatus.NOT_TAUGHT, reason: LessonDeliveryReason.TEACHER_ABSENT },
  ].map((r, i) => ({
    ...r,
    date: mondays[i]!,
    period_slot_id: mondaySlot.period_slot_id,
    is_extra: false,
  }));

  // An extra class on a free period (the routine seed uses period 5 for section B only).
  const freePeriod = await repos.periodSlotRepository.findOne({
    where: { tenant_id: tenantId, sequence: 3 },
  });
  if (freePeriod) {
    rows.push({
      date: extraDate!,
      period_slot_id: freePeriod.id,
      status: LessonDeliveryStatus.TAUGHT,
      reason: null,
      is_extra: true,
    });
  }

  for (const r of rows) {
    const key = {
      tenant_id: tenantId,
      section_id: section.id,
      date: r.date,
      period_slot_id: r.period_slot_id,
    };
    if (await repos.deliveryRepository.findOne({ where: key })) continue;
    await repos.deliveryRepository.save(
      repos.deliveryRepository.create({
        ...key,
        subject_id: math.id,
        status: r.status,
        reason: r.reason,
        is_extra: r.is_extra,
        recorded_by_user_id: teacherUser.id,
      }),
    );
  }
}
