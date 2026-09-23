import type { TabSpec } from '../../codec/tab-spec';
import { examsTab } from './exams.tab';
import { examComponentsTab } from './exam-components.tab';
import { markGridsTab } from './mark-grids.tab';
import { marksTab } from './marks.tab';
import { resultsTab } from './results.tab';
import { resultSubjectsTab } from './result-subjects.tab';
import { studentSubjectChoicesTab } from './student-subject-choices.tab';

/**
 * Tabs owned by the exams lane (19.10.1, #906). Registered in dependency
 * order: `exams` first (depends on `academic_years`/`classes`), then
 * `exam_components` (depends on `exams`/`subjects`), then `mark_grids`
 * (depends on `exams`/`sections`/`subjects`), then `marks` (depends on all
 * of the above plus `students`), then `results` (depends on
 * `exams`/`students`/`grading_scales`), then `result_subjects` (depends on
 * `results`), and finally `student_subject_choices` (depends on
 * `students`/`class_subjects`, unrelated to the rest of this group but
 * placed last since nothing after it depends on it).
 */
export const examsTabs: TabSpec<any, any>[] = [
  examsTab,
  examComponentsTab,
  markGridsTab,
  marksTab,
  resultsTab,
  resultSubjectsTab,
  studentSubjectChoicesTab,
];

export {
  examsTab,
  examComponentsTab,
  markGridsTab,
  marksTab,
  resultsTab,
  resultSubjectsTab,
  studentSubjectChoicesTab,
};
export type { ExamRow } from './exams.tab';
export type { ExamComponentRow } from './exam-components.tab';
export type { MarkGridRow } from './mark-grids.tab';
export type { MarkRow } from './marks.tab';
export type { ResultRow } from './results.tab';
export type { ResultSubjectRow } from './result-subjects.tab';
export type { StudentSubjectChoiceRow } from './student-subject-choices.tab';
