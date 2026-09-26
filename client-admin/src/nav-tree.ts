import type { EntityLabel } from '@biddaloy/shared';
import { Permission } from '@biddaloy/shared';

/**
 * [30.1.3]'s staff nav as plain, serialisable data — no JSX, no hooks, so
 * this module is importable from a plain `.test.ts` file the same way
 * `route-permissions.ts` is. `_staff.tsx` is what turns this into the
 * `AppShellNavGroup[]` `AppShell` actually renders: it supplies the
 * `ReactNode` icon per item (keyed by `id`) and resolves each item's
 * `label` — either through `useEntityLabel` ([30.1.2], for an entity noun
 * like "Students") or the `nav` namespace's `items` map (for everything
 * else, e.g. "Attendance", "Settings").
 *
 * **`id` is a stable contract, not a display detail.** Once shipped it must
 * never change: Epic 24.0's `RoleMenu` rows will join on an item's `id`,
 * and a *group's* `id` is what `AppShellNavGroup` already uses as its
 * `localStorage` collapse-state key (`app-shell.tsx`'s
 * `nav-group-collapsed:${group.id}`) — renaming a group id silently resets
 * every user's saved collapse preference for it.
 */
export type StaffNavLabel = { readonly entity: EntityLabel } | { readonly key: string };

export interface StaffNavItemDef {
  /** Stable id, e.g. `academics.classes`. Must not change across releases. */
  readonly id: string;
  /** Route path, passed straight through to `AppShellNavItem.to`. */
  readonly to: string;
  /** Omitted → every signed-in staff role sees the item (e.g. Dashboard). */
  readonly permission?: Permission;
  readonly label: StaffNavLabel;
  /** [30.5.1] Extra terms `CommandPalette`'s Page tab matches this item
   * against, alongside its translated `label` (en + bn) — plain-language
   * synonyms staff actually type ("routine" for the class timetable) that
   * would otherwise dead-end the search with no match. */
  readonly synonyms?: readonly string[];
}

export interface StaffNavGroupDef {
  /** Stable id — kept identical to the pre-30.1.3 groups (`people`,
   * `finance`, `communications`, `administration`) where the group
   * survives this restructure, so a user's saved collapse preference for
   * it survives too. */
  readonly id: string;
  readonly label: StaffNavLabel;
  readonly items: readonly StaffNavItemDef[];
  readonly pinnedItems?: readonly StaffNavItemDef[];
  readonly pinnedLabel?: StaffNavLabel;
}

/** Every nav item, flat, keyed by its own `id` — the lookup `_staff.tsx`
 * uses to attach an icon and resolve a label, and what
 * `nav-tree.test.ts` asserts ids against directly. */
export const STAFF_NAV_ITEMS = {
  dashboard: {
    id: 'dashboard',
    to: '/dashboard',
    permission: Permission.DASHBOARD_VIEW,
    label: { key: 'dashboard' },
  },
  'people.students': {
    id: 'people.students',
    to: '/students',
    permission: Permission.STUDENT_READ,
    label: { entity: 'student' },
  },
  'people.guardians': {
    id: 'people.guardians',
    to: '/guardians',
    permission: Permission.GUARDIAN_READ,
    label: { entity: 'guardian' },
  },
  'people.calendar': {
    id: 'people.calendar',
    to: '/calendar',
    permission: Permission.CALENDAR_READ,
    label: { key: 'calendar' },
  },
  'people.staff': {
    id: 'people.staff',
    to: '/staff',
    permission: Permission.USER_READ,
    label: { entity: 'staff' },
  },
  // [27.9] Staff admission intakes list — gated same as the route itself
  // (`route-permissions.ts`), `admission:review`.
  'people.admissionIntakes': {
    id: 'people.admissionIntakes',
    to: '/admissions/intakes',
    permission: Permission.ADMISSION_REVIEW,
    label: { key: 'admissionIntakes' },
  },
  // [27.10] Staff admission applicants list — same gate as the intakes
  // nav item above.
  'people.admissionApplicants': {
    id: 'people.admissionApplicants',
    to: '/admissions/applicants',
    permission: Permission.ADMISSION_REVIEW,
    label: { key: 'admissionApplicants' },
  },
  'academics.academicYears': {
    id: 'academics.academicYears',
    to: '/academic-years',
    permission: Permission.ACADEMIC_YEAR_MANAGE,
    label: { entity: 'academicYear' },
  },
  'academics.classes': {
    id: 'academics.classes',
    to: '/classes',
    permission: Permission.CLASS_MANAGE,
    label: { entity: 'class' },
  },
  'academics.homework': {
    id: 'academics.homework',
    to: '/academics/homework',
    permission: Permission.HOMEWORK_READ,
    label: { key: 'homework' },
    synonyms: ['assignment', 'classwork'],
  },
  'academics.syllabus': {
    id: 'academics.syllabus',
    to: '/academics/syllabus',
    permission: Permission.SYLLABUS_READ,
    label: { key: 'syllabus' },
  },
  'examsResults.gradingScales': {
    id: 'examsResults.gradingScales',
    to: '/grading-scales',
    permission: Permission.GRADING_SCALE_MANAGE,
    label: { key: 'gradingScales' },
  },
  // [19.6.1] `EXAM_MANAGE` — `/exams` is the exam management page, and
  // opening an exam's detail (`ExamsController.findOne`) plus every write
  // are `@Roles(ADMIN)` + `@RequirePermissions(EXAM_MANAGE)` server-side.
  // Only the bare list (`findAll`) is looser, on `MARK_VIEW`, so the
  // marks/analysis exam pickers load for teachers and executives.
  'examsResults.exams': {
    id: 'examsResults.exams',
    to: '/exams',
    permission: Permission.EXAM_MANAGE,
    label: { entity: 'exam' },
  },
  // [26.5.1] `MARK_VIEW` — same "seeing is weaker than editing" gate
  // `/marks` already uses; analysis is a read-only view over processed
  // results, not a write action like `/results`'s `RESULT_PROCESS`.
  'examsResults.analysis': {
    id: 'examsResults.analysis',
    to: '/analysis',
    permission: Permission.MARK_VIEW,
    label: { key: 'analysis' },
  },
  // [26.6.1] D22: PROMOTION_MANAGE (admin).
  'examsResults.promotion': {
    id: 'examsResults.promotion',
    to: '/promotions',
    permission: Permission.PROMOTION_MANAGE,
    label: { key: 'promotion' },
  },
  'academics.routineSetup': {
    id: 'academics.routineSetup',
    to: '/routines/setup',
    permission: Permission.ROUTINE_MANAGE,
    label: { key: 'routineSetup' },
  },
  'academics.routineBuilder': {
    id: 'academics.routineBuilder',
    to: '/routines',
    permission: Permission.ROUTINE_MANAGE,
    label: { key: 'routineBuilder' },
    synonyms: ['routine', 'timetable', 'grid'],
  },
  // [21.10.1] A teacher's own phone-first agenda — `ROUTINE_READ`
  // (`READ_ROLES` on `ResolveRoutineController`), not `ROUTINE_MANAGE`,
  // so every staff role that can see a routine at all sees this link,
  // not just the builder.
  'academics.myRoutine': {
    id: 'academics.myRoutine',
    to: '/routines/my',
    permission: Permission.ROUTINE_READ,
    label: { key: 'myRoutine' },
    synonyms: ['routine', 'timetable', 'agenda'],
  },
  'attendance.attendance': {
    id: 'attendance.attendance',
    to: '/attendance',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendance' },
    synonyms: ['routine', 'timetable'],
  },
  'attendance.attendanceReports': {
    id: 'attendance.attendanceReports',
    to: '/attendance/reports',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendanceReports' },
  },
  'attendance.attendanceRegister': {
    id: 'attendance.attendanceRegister',
    to: '/attendance/register',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendanceRegister' },
  },
  'finance.dues': {
    id: 'finance.dues',
    to: '/fees/dues',
    permission: Permission.FEE_COLLECT,
    label: { key: 'studentDues' },
  },
  'finance.recordPayment': {
    id: 'finance.recordPayment',
    to: '/payments/record',
    permission: Permission.PAYMENT_RECORD,
    label: { key: 'recordPayment' },
  },
  'finance.fees': {
    id: 'finance.fees',
    to: '/fees',
    permission: Permission.FEE_STRUCTURE_READ,
    label: { key: 'fees' },
  },
  'finance.feeStructures': {
    id: 'finance.feeStructures',
    to: '/fee-structures',
    permission: Permission.FEE_STRUCTURE_READ,
    label: { key: 'feeStructures' },
  },
  'finance.generateFees': {
    id: 'finance.generateFees',
    to: '/fees/generate',
    permission: Permission.FEE_GENERATE,
    label: { key: 'generateFees' },
  },
  'finance.recurringSchedules': {
    id: 'finance.recurringSchedules',
    to: '/fees/schedules',
    permission: Permission.SCHEDULE_MANAGE,
    label: { key: 'recurringSchedules' },
  },
  'finance.invoices': {
    id: 'finance.invoices',
    to: '/invoices',
    permission: Permission.INVOICE_READ,
    label: { entity: 'invoice' },
  },
  'reports.collectionsReport': {
    id: 'reports.collectionsReport',
    to: '/reports/collections',
    permission: Permission.REPORT_COLLECTIONS_READ,
    label: { key: 'collectionsReport' },
  },
  'communications.sendMessage': {
    id: 'communications.sendMessage',
    to: '/communications/send',
    permission: Permission.COMMUNICATION_SEND,
    label: { key: 'sendMessage' },
  },
  'communications.feeReminders': {
    id: 'communications.feeReminders',
    to: '/communications/reminders',
    permission: Permission.COMMUNICATION_BULK_SEND,
    label: { key: 'feeReminders' },
  },
  'communications.reminderHistory': {
    id: 'communications.reminderHistory',
    to: '/communications/batches',
    permission: Permission.COMMUNICATION_BULK_SEND,
    label: { key: 'reminderHistory' },
  },
  'administration.auditLogs': {
    id: 'administration.auditLogs',
    to: '/audit-logs',
    permission: Permission.AUDIT_LOG_READ,
    label: { key: 'auditLogs' },
  },
  'administration.settings': {
    id: 'administration.settings',
    to: '/settings',
    permission: Permission.SETTINGS_MANAGE,
    label: { key: 'settings' },
  },
} as const satisfies Record<string, StaffNavItemDef>;

/**
 * The [15-ux-principles.md] §3 restructure: Dashboard stays a flat item;
 * People/Finance/Communications/Administration keep their pre-30.1.3
 * group `id`s (so saved collapse preferences survive) but shed the items
 * the three new domain groups now own; **Academics**, **Attendance** and
 * **Reports** are new groups carved out of Administration/People/Finance;
 * **Exams & Results** started with zero items ([30.1.3]) — `AppShell`
 * auto-hides an empty group (`app-shell.tsx`'s `NavGroupSection`) — and
 * gained its first two, `examsResults.gradingScales` and (19.6.1)
 * `examsResults.exams`, as Epic 19.0 landed routes for it.
 */
/** [30.5.1] `CommandPalette`'s Page-tab match predicate: does `query`
 * appear in the item's already-resolved display `label`, or in one of
 * its `synonyms`? Pure and React-free so it is unit-testable directly,
 * without rendering the palette — `command-palette-launcher.tsx` is the
 * only caller. An empty `query` never matches anything: the Page tab
 * shows a searchable hint for an empty query rather than every item. */
export function matchesNavSearch(
  label: string,
  synonyms: readonly string[] | undefined,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return false;
  if (label.toLowerCase().includes(trimmed)) return true;
  return (synonyms ?? []).some((synonym) => synonym.toLowerCase().includes(trimmed));
}

export const STAFF_NAV_GROUPS: readonly StaffNavGroupDef[] = [
  {
    id: 'people',
    label: { key: 'people' },
    items: [
      STAFF_NAV_ITEMS['people.students'],
      STAFF_NAV_ITEMS['people.guardians'],
      STAFF_NAV_ITEMS['people.calendar'],
      STAFF_NAV_ITEMS['people.staff'],
      STAFF_NAV_ITEMS['people.admissionIntakes'],
      STAFF_NAV_ITEMS['people.admissionApplicants'],
    ],
  },
  {
    id: 'academics',
    label: { key: 'academics' },
    items: [
      STAFF_NAV_ITEMS['academics.academicYears'],
      STAFF_NAV_ITEMS['academics.classes'],
      STAFF_NAV_ITEMS['academics.routineSetup'],
      STAFF_NAV_ITEMS['academics.routineBuilder'],
      STAFF_NAV_ITEMS['academics.myRoutine'],
      STAFF_NAV_ITEMS['academics.homework'],
      STAFF_NAV_ITEMS['academics.syllabus'],
    ],
  },
  {
    id: 'attendance',
    label: { key: 'attendance' },
    items: [
      STAFF_NAV_ITEMS['attendance.attendance'],
      STAFF_NAV_ITEMS['attendance.attendanceReports'],
      STAFF_NAV_ITEMS['attendance.attendanceRegister'],
    ],
  },
  {
    id: 'examsResults',
    label: { key: 'examsResults' },
    items: [
      STAFF_NAV_ITEMS['examsResults.exams'],
      STAFF_NAV_ITEMS['examsResults.gradingScales'],
      STAFF_NAV_ITEMS['examsResults.analysis'],
      STAFF_NAV_ITEMS['examsResults.promotion'],
    ],
  },
  {
    id: 'finance',
    label: { key: 'finance' },
    pinnedLabel: { key: 'quickActions' },
    pinnedItems: [STAFF_NAV_ITEMS['finance.dues'], STAFF_NAV_ITEMS['finance.recordPayment']],
    items: [
      STAFF_NAV_ITEMS['finance.fees'],
      STAFF_NAV_ITEMS['finance.feeStructures'],
      STAFF_NAV_ITEMS['finance.generateFees'],
      STAFF_NAV_ITEMS['finance.recurringSchedules'],
      STAFF_NAV_ITEMS['finance.invoices'],
    ],
  },
  {
    id: 'reports',
    label: { key: 'reports' },
    items: [STAFF_NAV_ITEMS['reports.collectionsReport']],
  },
  {
    id: 'communications',
    label: { key: 'communications' },
    items: [
      STAFF_NAV_ITEMS['communications.sendMessage'],
      STAFF_NAV_ITEMS['communications.feeReminders'],
      STAFF_NAV_ITEMS['communications.reminderHistory'],
    ],
  },
  {
    id: 'administration',
    label: { key: 'administration' },
    items: [
      STAFF_NAV_ITEMS['administration.auditLogs'],
      STAFF_NAV_ITEMS['administration.settings'],
    ],
  },
];
