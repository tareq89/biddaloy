import type { StaffNavLabel } from './nav-tree';

/**
 * [30.3.1]'s one map: every leaf route's TanStack **route ID** (not
 * path — index routes carry a trailing slash, same convention
 * `route-permissions.ts` and `nav-tree.ts`'s `NAV_PATH_TO_ROUTE_ID` use)
 * to the breadcrumb trail shown for that page.
 *
 * A trail is an ordered list of segments, outermost first. A segment
 * reuses `StaffNavLabel` (`{ key }` for a plain i18n string, `{ entity }`
 * for an `EntityLabel` noun resolved via `useEntityLabel`) so a route
 * that already has a nav item can share its exact label rather than
 * inventing a second string for the same thing.
 *
 * `dynamic: 'entity'` marks a segment whose real label the *consumer*
 * fills in once the page's own entity has loaded (e.g. a student's
 * name). Until then the segment's `label` is shown as a loading
 * fallback — that's why it's a plain `StaffNavLabel`, not omitted.
 *
 * A route with no sensible trail — an auth screen, the root redirect —
 * gets an explicit `null` plus a one-line reason, mirroring
 * `nav-not-in-nav.ts`'s (30.1.5) "reason required" convention for routes
 * that opt out of the nav rather than being missed by accident.
 *
 * This module is pure data: no React, no `useEntityLabel` call, no
 * fetch. `route-crumbs.test.ts` guards it bidirectionally against
 * `routeTree.gen.ts` the same way `route-permissions.test.ts` guards
 * `STAFF_ROUTE_PERMISSIONS` — a route added without a crumb entry (or
 * deleted while its entry lingers) fails the test by name.
 */
export interface CrumbSegment {
  readonly label: StaffNavLabel;
  readonly dynamic?: 'entity';
}

export type RouteCrumbs = readonly CrumbSegment[];

/** Reason a route has no breadcrumb trail — always non-empty, same
 * discipline `nav-not-in-nav.ts` (30.1.5) uses for `NOT_IN_NAV`. */
export type NoCrumbReason = string;

export const ROUTE_CRUMBS: Record<string, RouteCrumbs | NoCrumbReason> = {
  // --- Auth flow + root: no signed-in shell to show a trail in ---
  '/': 'root redirect, never renders its own page',
  '/login': 'pre-auth screen, no shell',
  '/activate': 'pre-auth screen, no shell',
  '/forgot-password': 'pre-auth screen, no shell',
  '/reset-password': 'pre-auth screen, no shell',
  '/verify-email': 'pre-auth screen, no shell',
  '/select-school': 'post-auth, pre-tenant-selection — no tenant nav to trail into yet',
  '/i/$token': 'public invite-accept link, opened signed-out',

  // --- Guardian portal: tab nav, no breadcrumb chrome ---
  '/portal/': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/account': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/attendance': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/calendar': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/exam-schedule': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/fees': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/routine': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/results': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/syllabus': 'guardian portal uses bottom tab nav, no breadcrumb chrome',

  // --- Platform (SUPER_ADMIN) area ---
  '/_platform/holiday-sets/': [{ label: { key: 'holidaySets' } }],
  '/_platform/holiday-sets/$setId': [
    { label: { key: 'holidaySets' } },
    { label: { key: 'holidaySetDetail' }, dynamic: 'entity' },
  ],
  '/_platform/schools/': [{ label: { key: 'schools' } }],
  '/_platform/schools/new': [{ label: { key: 'schools' } }, { label: { key: 'new' } }],
  '/_platform/schools/$schoolId': [
    { label: { key: 'schools' } },
    { label: { key: 'schoolDetail' }, dynamic: 'entity' },
  ],

  // --- Staff shell: top-level pages mirror their nav item's own label ---
  '/_staff/dashboard': [{ label: { key: 'dashboard' } }],
  '/_staff/notifications': [{ label: { key: 'notifications' } }],
  '/_staff/security': [{ label: { key: 'security' } }],
  '/_staff/students/': [{ label: { entity: 'student' } }],
  '/_staff/guardians/': [{ label: { entity: 'guardian' } }],
  '/_staff/calendar/': [{ label: { key: 'calendar' } }],
  '/_staff/staff/': [{ label: { entity: 'staff' } }],
  '/_staff/academic-years/': [{ label: { entity: 'academicYear' } }],
  '/_staff/classes/': [{ label: { entity: 'class' } }],
  '/_staff/academics/homework/': [{ label: { key: 'homework' } }],
  '/_staff/academics/homework/new': [{ label: { key: 'homework' } }, { label: { key: 'new' } }],
  '/_staff/academics/homework/$homeworkId': [
    { label: { key: 'homework' } },
    { label: { key: 'homeworkDetail' }, dynamic: 'entity' },
  ],
  '/_staff/academics/homework/import': [
    { label: { key: 'homework' } },
    { label: { key: 'import' } },
  ],
  '/_staff/academics/syllabus/': [{ label: { key: 'syllabus' } }],
  '/_staff/exams/': [{ label: { entity: 'exam' } }],
  // [25.6] Single-level, same as `/_staff/exams/` above — no separate
  // "Exams & Results" segment; that's the nav group label, not part of
  // any sibling route's own crumb trail either.
  '/_staff/exams/seat-plans/': [{ label: { key: 'seatPlans' } }],
  // [25.7] No entity resolver registered for seat plans (`use-breadcrumbs.ts`'s
  // `ENTITY_RESOLVERS` is a deliberate short list — student/guardian/class/
  // academic year only) — same scope line `results/$examId/$studentId` and
  // `marks/$examId/.../$subjectId` already accept, so this segment's dynamic
  // label falls back to the raw plan id, not the plan's name.
  '/_staff/exams/seat-plans/$planId': [
    { label: { key: 'seatPlans' } },
    { label: { key: 'seatPlanDetail' }, dynamic: 'entity' },
  ],
  '/_staff/marks/': [{ label: { key: 'marksEntry' } }],
  '/_staff/results/': [{ label: { key: 'results' } }],
  '/_staff/grading-scales/': [{ label: { key: 'gradingScales' } }],
  '/_staff/routines/setup': [{ label: { key: 'routineSetup' } }],
  '/_staff/routines/': [{ label: { key: 'routineBuilder' } }],
  '/_staff/routines/$sectionId': [
    { label: { key: 'routineBuilder' } },
    { label: { key: 'section' }, dynamic: 'entity' },
  ],
  '/_staff/routines/review': [{ label: { key: 'routineReview' } }],
  '/_staff/routines/substitutions': [{ label: { key: 'routineSubstitutions' } }],
  '/_staff/routines/my': [{ label: { key: 'myRoutine' } }],
  '/_staff/attendance/': [{ label: { key: 'attendance' } }],
  '/_staff/attendance/reports': [{ label: { key: 'attendanceReports' } }],
  '/_staff/attendance/register': [{ label: { key: 'attendanceRegister' } }],
  '/_staff/fees/dues': [{ label: { key: 'studentDues' } }],
  '/_staff/payments/record': [{ label: { key: 'recordPayment' } }],
  '/_staff/fees/': [{ label: { key: 'fees' } }],
  '/_staff/fee-structures/': [{ label: { key: 'feeStructures' } }],
  '/_staff/fees/generate': [{ label: { key: 'generateFees' } }],
  '/_staff/fees/schedules/': [{ label: { key: 'recurringSchedules' } }],
  '/_staff/invoices/': [{ label: { entity: 'invoice' } }],
  '/_staff/reports/collections': [{ label: { key: 'collectionsReport' } }],
  '/_staff/communications/send': [{ label: { key: 'sendMessage' } }],
  '/_staff/communications/reminders': [{ label: { key: 'feeReminders' } }],
  '/_staff/communications/batches/': [{ label: { key: 'reminderHistory' } }],
  '/_staff/audit-logs/': [{ label: { key: 'auditLogs' } }],
  '/_staff/settings': [{ label: { key: 'settings' } }],

  // --- Staff shell: sub-pages nest under their list route's segment ---
  '/_staff/students/new': [{ label: { entity: 'student' } }, { label: { key: 'new' } }],
  '/_staff/students/import': [{ label: { entity: 'student' } }, { label: { key: 'import' } }],
  '/_staff/students/$studentId': [
    { label: { entity: 'student' } },
    { label: { entity: 'student' }, dynamic: 'entity' },
  ],
  '/_staff/students/$studentId_/edit': [
    { label: { entity: 'student' } },
    { label: { entity: 'student' }, dynamic: 'entity' },
    { label: { key: 'edit' } },
  ],
  '/_staff/guardians/$guardianId': [
    { label: { entity: 'guardian' } },
    { label: { entity: 'guardian' }, dynamic: 'entity' },
  ],
  '/_staff/calendar/import': [{ label: { key: 'calendar' } }, { label: { key: 'import' } }],
  '/_staff/staff/$userId': [
    { label: { entity: 'staff' } },
    { label: { entity: 'staff' }, dynamic: 'entity' },
  ],
  '/_staff/academic-years/$academicYearId': [
    { label: { entity: 'academicYear' } },
    { label: { entity: 'academicYear' }, dynamic: 'entity' },
  ],
  '/_staff/classes/$classId': [
    { label: { entity: 'class' } },
    { label: { entity: 'class' }, dynamic: 'entity' },
  ],
  '/_staff/exams/$examId': [
    { label: { entity: 'exam' } },
    { label: { entity: 'exam' }, dynamic: 'entity' },
  ],
  '/_staff/marks/$examId/$sectionId/$subjectId': [
    { label: { key: 'marksEntry' } },
    { label: { key: 'marksEntryGrid' }, dynamic: 'entity' },
  ],
  '/_staff/results/$examId/$studentId': [
    { label: { key: 'results' } },
    { label: { key: 'reportCard' }, dynamic: 'entity' },
  ],
  '/_staff/grading-scales/$scaleId': [
    { label: { key: 'gradingScales' } },
    { label: { key: 'gradingScaleDetail' }, dynamic: 'entity' },
  ],
  '/_staff/attendance/$sectionId': [
    { label: { key: 'attendance' } },
    { label: { key: 'section' }, dynamic: 'entity' },
  ],
  '/_staff/fees/schedules/$id': [
    { label: { key: 'recurringSchedules' } },
    { label: { key: 'scheduleDetail' }, dynamic: 'entity' },
  ],
  '/_staff/invoices/$invoiceId': [
    { label: { entity: 'invoice' } },
    { label: { entity: 'invoice' }, dynamic: 'entity' },
  ],
  '/_staff/payments/': [{ label: { key: 'recordPayment' } }],
  '/_staff/payments/$id': [
    { label: { key: 'recordPayment' } },
    { label: { key: 'paymentDetail' }, dynamic: 'entity' },
  ],
  '/_staff/communications/batches/$batchId': [
    { label: { key: 'reminderHistory' } },
    { label: { key: 'batchDetail' }, dynamic: 'entity' },
  ],
};
