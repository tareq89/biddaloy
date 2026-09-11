import type { TabSpec } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { classesTab } from './classes.tab';
import { sectionsTab } from './sections.tab';

/**
 * Tabs owned by the academics lane. Registered in dependency order:
 * `academic_years` first (depends only on `school`), then `classes`
 * (depends on `academic_years`), then `sections` (depends on `classes` and
 * `academic_years`).
 */
export const academicsTabs: TabSpec<any, any>[] = [academicYearsTab, classesTab, sectionsTab];

export { academicYearsTab, classesTab, sectionsTab };
export type { AcademicYearRow } from './academic-years.tab';
export type { ClassRow } from './classes.tab';
export type { ClassSectionRow } from './sections.tab';
