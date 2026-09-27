import type { TabSpec } from '../../codec/tab-spec';
import { programsTab } from './programs.tab';
import { programMilestonesTab } from './program-milestones.tab';
import { programEnrollmentsTab } from './program-enrollments.tab';
import { milestoneAchievementsTab } from './milestone-achievements.tab';

/**
 * Tabs owned by the programs lane (Epic 34.0, [34.1.4]). Registered in
 * dependency order: `programs` first (no dependency), then
 * `program_milestones` (depends on `programs`), then `program_enrollments`
 * (depends on `programs` and `students`), then `milestone_achievements`
 * (depends on `program_enrollments` and `program_milestones`).
 */
export const programsTabs: TabSpec<any, any>[] = [
  programsTab,
  programMilestonesTab,
  programEnrollmentsTab,
  milestoneAchievementsTab,
];

export { programsTab, programMilestonesTab, programEnrollmentsTab, milestoneAchievementsTab };
export type { ProgramRow } from './programs.tab';
export type { ProgramMilestoneRow } from './program-milestones.tab';
export type { ProgramEnrollmentRow } from './program-enrollments.tab';
export type { MilestoneAchievementRow } from './milestone-achievements.tab';
