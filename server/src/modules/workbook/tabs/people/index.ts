import type { TabSpec } from '../../codec/tab-spec';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { guardiansTab } from './guardians.tab';
import { studentsTab } from './students.tab';
import { enrollmentsTab } from './enrollments.tab';

/**
 * Tabs owned by the people lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * Registered in dependency order: `users` first (depends only on `school`),
 * then `teachers` (depends on `users`), then `teacher_assignments`
 * (depends on `teachers` plus the academics lane's `classes`,
 * `academic_years`, `sections`, `subjects`). `guardians` depends only on
 * `users`, but sits after `teacher_assignments` because the registry must be
 * a subsequence of `EXPECTED_TABS` (`codec/registry.ts`). `students` depends
 * on `users`, `classes`, `academic_years`, `sections`, and `guardians`;
 * appending it last is correct because `EXPECTED_TABS` places `students`
 * directly after `guardians`. `enrollments` depends on `students`, `classes`,
 * `academic_years` and `sections`, and goes last because `EXPECTED_TABS`
 * places it directly after `students`, with the fees lane's tabs following.
 */
export const peopleTabs: TabSpec<any, any>[] = [
  usersTab,
  teachersTab,
  teacherAssignmentsTab,
  guardiansTab,
  studentsTab,
  enrollmentsTab,
];

export { usersTab, teachersTab, teacherAssignmentsTab, guardiansTab, studentsTab, enrollmentsTab };
export type { UserRow } from './users.tab';
export type { TeacherRow } from './teachers.tab';
export type { TeacherAssignmentRow } from './teacher-assignments.tab';
export type { GuardianRow } from './guardians.tab';
export type { StudentRow } from './students.tab';
export type { EnrollmentRow } from './enrollments.tab';
