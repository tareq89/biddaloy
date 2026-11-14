import type { DemoSlice } from './context';
import { slice as org } from './slices/org';
import { slice as staff } from './slices/staff';
import { slice as students } from './slices/students';
import { slice as studentExtras } from './slices/student-extras';
import { slice as routine } from './slices/routine';
import { slice as attendance } from './slices/attendance';
import { slice as fees } from './slices/fees';
import { slice as exams } from './slices/exams';
import { slice as learning } from './slices/learning';
import { slice as peopleOps } from './slices/people-ops';
import { slice as commsPrint } from './slices/comms-print';
import { slice as applications } from './slices/applications';
import { slice as smsBundles } from './slices/sms-bundles';
import { slice as billing } from './slices/billing';
import { slice as reports } from './slices/reports';
import { slice as attention } from './slices/attention';
import { slice as notices } from './slices/notices';
import { slice as website } from './slices/website';
import { slice as gallery } from './slices/gallery';

/** Run order matters: later slices read ids earlier ones publish. `attention` is always last. */
export const SLICES: DemoSlice[] = [
  org,
  staff,
  students,
  studentExtras,
  routine,
  attendance,
  fees,
  exams,
  learning,
  peopleOps,
  commsPrint,
  smsBundles,
  applications,
  billing,
  reports,
  notices,
  website,
  gallery,
  attention,
];

/** Entities that no slice fills, with the reason. `demo-seed.coverage.integration.spec.ts` reads this. */
export const EXEMPT: Record<string, string> = {
  PlatformAlert: 'platform incident state, not school data',
  SmsCreditLotDraw:
    'a fresh demo has no send in flight; a fake open draw would hold units no send settles',
  // [Epic 100 #3875] Plans and coupons are platform money data. The billing slice (second plan, a
  // coupon, a coupon order, a refund) is the open seed step of #3875; remove these four with it.
  Plan: 'platform pricing data; demo billing slice seeds it in #3875 step 5, still open',
  Coupon: 'platform pricing data; demo billing slice seeds it in #3875 step 5, still open',
  CouponSchool: 'platform pricing data; demo billing slice seeds it in #3875 step 5, still open',
  CouponRedemption:
    'platform pricing data; demo billing slice seeds it in #3875 step 5, still open',
  PlatformAdmin: 'platform data, no cockpit on demo',
  PlatformAdminDevice: 'platform data, no cockpit on demo',
  PlatformApproval: 'platform data, no cockpit on demo',
  PlatformSetting: 'platform data, no cockpit on demo',
  ImpersonationSession: 'platform data, no cockpit on demo (Epic 98 D33)',
  PlatformSchoolNote: 'platform data, no cockpit on demo (Epic 98 D33)',
  PlatformAnnouncement: 'platform data, no cockpit on demo (Epic 98 D33)',
  UserMfa: 'platform data, no cockpit on demo',
  UserRecoveryCode: 'platform data, no cockpit on demo',
  PushSubscription: 'push is off in the demo (D2)',
  RefreshToken: 'login state, minted by real sign-ins',
  AuthToken: 'login state: reset / verification tokens',
  UserIdentity: 'login state: sign-in credentials come from the seeded users',
  WorkbookJob: 'backups are off in the demo (D2)',
  AuditLog: 'written by services as a side effect, never seeded directly',
  ReportSnapshot: 'runtime output: a stored copy of one run (Epic 8.15)',
  ReportSchedule: 'runtime output: schedules are set up by the school (Epic 8.15)',
};
