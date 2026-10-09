import type { TabSpec } from '../../codec/tab-spec';
import { staffAttendanceSessionTab } from './staff-attendance-session.tab';
import { staffAttendanceRecordTab } from './staff-attendance-record.tab';

/**
 * Tabs owned by the staff-attendance lane (Epic 36.2). New barrel — the
 * `attendance` group didn't exist under `tabs/` before this ticket.
 *
 * Registered in dependency order: `staff_attendance_sessions` first (no
 * dependencies of its own), then `staff_attendance_records`, which depends
 * on both `staff_attendance_sessions` and the people lane's
 * `staff_profiles`. `EXPECTED_TABS` (`codec/registry.ts`) places both
 * directly after `users`.
 */
export const attendanceTabs: TabSpec<any, any>[] = [
  staffAttendanceSessionTab,
  staffAttendanceRecordTab,
];

export { staffAttendanceSessionTab, staffAttendanceRecordTab };
export type { StaffAttendanceSessionRow } from './staff-attendance-session.tab';
export type { StaffAttendanceRecordRow } from './staff-attendance-record.tab';
