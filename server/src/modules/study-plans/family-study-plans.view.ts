import type { StudyPlanExamMarker } from '@biddaloy/shared';
import type { ScheduleLessonDto, SchedulePeriodDto } from './dto/plan-schedule.dto';
import type {
  FamilyExamSyllabusDto,
  FamilyLastTaughtDto,
  FamilyLessonRefDto,
  FamilyNextLessonDto,
  FamilySubjectPlanDto,
  FamilySubjectRefDto,
} from './dto/family-study-plans.dto';

/** The slice of a plan schedule the mapper reads. Notes and unreported counts are not in it. */
export interface FamilyScheduleInput {
  lessons: ScheduleLessonDto[];
  periods: SchedulePeriodDto[];
  summary: {
    periods_behind: number;
    lessons_behind: number;
    lessons_done: number;
    lessons_total: number;
  };
}

export type FamilyExamInfo = Map<string, { name: string; date: string | null }>;

export const FAMILY_NEXT_LIMIT = 5;

/** Latest TAUGHT period's lesson (PARTLY does not count), with its 1-based plan number. */
export function lastTaught(s: FamilyScheduleInput): FamilyLastTaughtDto | null {
  let best: SchedulePeriodDto | null = null;
  for (const p of s.periods) {
    if (p.status === 'TAUGHT' && p.lesson_id && (!best || p.date >= best.date)) best = p;
  }
  if (!best) return null;
  const idx = s.lessons.findIndex((l) => l.id === best!.lesson_id);
  return idx < 0 ? null : { number: idx + 1, title: s.lessons[idx]!.title, date: best.date };
}

/** First 5 lessons not DONE, in plan order; overflow lessons carry a null date. */
export function nextLessons(s: FamilyScheduleInput): FamilyNextLessonDto[] {
  const out: FamilyNextLessonDto[] = [];
  s.lessons.forEach((l, i) => {
    if (l.status !== 'DONE' && out.length < FAMILY_NEXT_LIMIT) {
      out.push({
        number: i + 1,
        title: l.title,
        expected_date: l.overflow ? null : l.expected_date,
      });
    }
  });
  return out;
}

/** The last lesson's end date; null with no lessons or when any lesson overflows. */
export function expectedFinishDate(s: FamilyScheduleInput): string | null {
  if (!s.lessons.length || s.lessons.some((l) => l.overflow)) return null;
  return s.lessons[s.lessons.length - 1]!.expected_end_date;
}

/** Markers whose exam or lesson vanished are dropped (D32). */
export function examSyllabus(
  s: FamilyScheduleInput,
  markers: StudyPlanExamMarker[],
  exams: FamilyExamInfo,
): FamilyExamSyllabusDto[] {
  const out: FamilyExamSyllabusDto[] = [];
  for (const m of markers) {
    const exam = exams.get(m.exam_id);
    const idx = s.lessons.findIndex((l) => l.id === m.up_to_lesson_id);
    if (!exam || idx < 0) continue;
    out.push({
      exam_id: m.exam_id,
      exam_name: exam.name,
      exam_date: exam.date,
      lessons_in_syllabus: idx + 1,
      lessons_taught: s.lessons.slice(0, idx + 1).filter((l) => l.status === 'DONE').length,
    });
  }
  return out;
}

export function subjectBlock(input: {
  planId: string;
  subject: FamilySubjectRefDto;
  teacherNames: string[];
  schedule: FamilyScheduleInput;
  markers: StudyPlanExamMarker[];
  exams: FamilyExamInfo;
}): FamilySubjectPlanDto {
  const s = input.schedule;
  return {
    subject: input.subject,
    plan_id: input.planId,
    teacher_names: input.teacherNames,
    last_taught: lastTaught(s),
    next: nextLessons(s),
    expected_finish_date: expectedFinishDate(s),
    periods_behind: s.summary.periods_behind,
    lessons_behind: s.summary.lessons_behind,
    lessons_done: s.summary.lessons_done,
    lessons_total: s.summary.lessons_total,
    exam_syllabus: examSyllabus(s, input.markers, input.exams),
  };
}

/**
 * The lesson on one dated period: its plan number and which of its periods
 * this is (same counting as the teacher's day view). `seq` maps slot id to sequence.
 */
export function lessonAt(
  s: Pick<FamilyScheduleInput, 'lessons' | 'periods'>,
  date: string,
  periodSlotId: string,
  seq: Map<string, number>,
): FamilyLessonRefDto | null {
  const at = s.periods.find(
    (p) => p.date === date && p.period_slot_id === periodSlotId && p.lesson_id,
  );
  const idx = at ? s.lessons.findIndex((l) => l.id === at.lesson_id) : -1;
  if (!at || idx < 0) return null;
  const l = s.lessons[idx]!;
  const mine = seq.get(periodSlotId) ?? 0;
  const part =
    s.periods.filter(
      (p) =>
        p.lesson_id === l.id &&
        (p.date < date || (p.date === date && (seq.get(p.period_slot_id) ?? 0) <= mine)),
    ).length || 1;
  return { number: idx + 1, title: l.title, part, of: l.periods };
}
