/** Test-only builders for the study-plan detail DTOs. */
import type { StudyPlanDetail, StudyPlanScheduleResponse } from '@biddaloy/ui/hooks';

type ScheduleLesson = StudyPlanScheduleResponse['lessons'][number];

export function lessonItems(count: number): StudyPlanDetail['lessons'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `l${i + 1}`,
    title: `Lesson ${i + 1}`,
    periods: 1,
  }));
}

export function planFactory(overrides: Partial<StudyPlanDetail> = {}): StudyPlanDetail {
  const lessons = overrides.lessons ?? lessonItems(3);
  return {
    id: 'plan-1',
    academic_year_id: 'year-1',
    section: { id: 'sec-1', name: 'A', class_id: 'class-1', class_name: 'Class 7' },
    subject: { id: 'sub-1', name_en: 'Mathematics', name_bn: null, code: 'MATH' },
    term: { id: 'term-1', name: 'First term' },
    lesson_count: lessons.length,
    owners: [{ teacher_id: 't-1', full_name: 'Rahima Akter' }],
    owner_override_teacher_id: null,
    can_edit: true,
    lessons,
    exam_markers: [],
    ...overrides,
  };
}

export function scheduleFactory(
  lessons: ScheduleLesson[],
  summary: Partial<StudyPlanScheduleResponse['summary']> = {},
): StudyPlanScheduleResponse {
  return {
    range: { from: '2026-01-01', to: '2026-06-30' },
    today: '2026-03-01',
    periods: [],
    lessons,
    summary: {
      lessons_done: lessons.filter((l) => l.status === 'DONE').length,
      lessons_total: lessons.length,
      periods_behind: 0,
      lessons_behind: 0,
      unreported_periods: 0,
      unreported_school_days: 0,
      oldest_unreported_date: null,
      last_reported_at: null,
      capacity: { periods_left: 58, periods_needed: 62, fits: false },
      routine_missing: false,
      ...summary,
    },
  };
}

export function scheduleLesson(
  id: string,
  status: ScheduleLesson['status'],
  overrides: Partial<ScheduleLesson> = {},
): ScheduleLesson {
  return {
    id,
    title: id,
    periods: 1,
    taught_periods: status === 'DONE' ? 1 : 0,
    status,
    expected_date: '2026-03-02',
    expected_end_date: null,
    overflow: false,
    in_extra_class: false,
    ...overrides,
  };
}
