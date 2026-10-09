import type { TabSpec } from '../../codec/tab-spec';
import { leavePolicyTab } from './leave-policy.tab';
import { leaveRecordTab } from './leave-record.tab';

/**
 * Tabs owned by the leave lane (Epic 36.3). New barrel — the `hr` group
 * didn't exist under `tabs/` before this ticket.
 *
 * Registered in dependency order: `leave_policies` first (no dependencies
 * of its own), then `leave_records`, which depends on the people lane's
 * `staff_profiles` and `users`. `EXPECTED_TABS` (`codec/registry.ts`)
 * places both after `staff_profiles`.
 */
export const hrTabs: TabSpec<any, any>[] = [leavePolicyTab, leaveRecordTab];

export { leavePolicyTab, leaveRecordTab };
export type { LeavePolicyRow } from './leave-policy.tab';
export type { LeaveRecordRow } from './leave-record.tab';
