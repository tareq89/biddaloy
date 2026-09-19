import type { TabSpec } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { classesTab } from './classes.tab';
import { sectionsTab } from './sections.tab';
import { subjectsTab } from './subjects.tab';
import { classSubjectsTab } from './class-subjects.tab';
import { calendarEventsTab } from './calendar-events.tab';

/**
 * Tabs owned by the academics lane. Registered in dependency order:
 * `academic_years` first (depends only on `school`), then `classes`
 * (depends on `academic_years`), then `sections` (depends on `classes` and
 * `academic_years`), then `subjects` (depends only on `school`), then
 * `class_subjects` (depends on `classes` and `subjects`), then
 * `calendar_events` (depends on `academic_years` and `classes`; renamed
 * from `holidays` in [17.2.5]).
 */
export const academicsTabs: TabSpec<any, any>[] = [
  academicYearsTab,
  classesTab,
  sectionsTab,
  subjectsTab,
  classSubjectsTab,
  calendarEventsTab,
];

export {
  academicYearsTab,
  classesTab,
  sectionsTab,
  subjectsTab,
  classSubjectsTab,
  calendarEventsTab,
};
export type { AcademicYearRow } from './academic-years.tab';
export type { ClassRow } from './classes.tab';
export type { ClassSectionRow } from './sections.tab';
export type { SubjectRow } from './subjects.tab';
export type { ClassSubjectRow } from './class-subjects.tab';
export type { CalendarEventRow } from './calendar-events.tab';
