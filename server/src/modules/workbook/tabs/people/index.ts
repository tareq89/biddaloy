import type { TabSpec } from '../../codec/tab-spec';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';

/**
 * Tabs owned by the people lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * Registered in dependency order: `users` first (depends only on `school`),
 * then `teachers` (depends on `users`), then `teacher_assignments`
 * (depends on `teachers` plus the academics lane's `classes`,
 * `academic_years`, `sections`, `subjects`).
 */
export const peopleTabs: TabSpec<any, any>[] = [usersTab, teachersTab, teacherAssignmentsTab];

export { usersTab, teachersTab, teacherAssignmentsTab };
export type { UserRow } from './users.tab';
export type { TeacherRow } from './teachers.tab';
export type { TeacherAssignmentRow } from './teacher-assignments.tab';
