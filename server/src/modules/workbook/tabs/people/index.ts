import type { TabSpec } from '../../codec/tab-spec';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { guardiansTab } from './guardians.tab';

/**
 * Tabs owned by the people lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * Registered in dependency order: `users` first (depends only on `school`),
 * then `teachers` (depends on `users`), then `teacher_assignments`
 * (depends on `teachers` plus the academics lane's `classes`,
 * `academic_years`, `sections`, `subjects`). `guardians` depends only on
 * `users`, but sits after `teacher_assignments` because the registry must be
 * a subsequence of `EXPECTED_TABS` (`codec/registry.ts`).
 */
export const peopleTabs: TabSpec<any, any>[] = [
  usersTab,
  teachersTab,
  teacherAssignmentsTab,
  guardiansTab,
];

export { usersTab, teachersTab, teacherAssignmentsTab, guardiansTab };
export type { UserRow } from './users.tab';
export type { TeacherRow } from './teachers.tab';
export type { TeacherAssignmentRow } from './teacher-assignments.tab';
export type { GuardianRow } from './guardians.tab';
