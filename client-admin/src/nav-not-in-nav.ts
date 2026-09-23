/**
 * [30.1.5] The allowlist for `nav-tree.test.ts`'s Direction A guard: every
 * leaf route in `routeTree.gen.ts` must either resolve through
 * `STAFF_NAV_GROUPS`/`STAFF_NAV_ITEMS`, or have a one-line reason here for
 * why it legitimately has no sidebar home. Copies
 * `registry.completeness.spec.ts`'s "reason required" convention
 * (`server/src/modules/workbook/codec/registry.ts`'s `excluded`) — a typo'd
 * route id here would silently mean "we don't need this in the sidebar,"
 * the same failure mode `route-permissions.test.ts` closes for permissions.
 *
 * Keyed by the route's `id` in `router.routesById` (the same id
 * `route-permissions.test.ts` uses), not by URL path.
 */
export const NOT_IN_NAV: Record<string, string> = {
  // Public/auth routes — reached before a signed-in staff nav ever renders.
  '/': 'root redirect, resolves to /login or /dashboard before any nav renders',
  '/activate': 'auth route reached via an email link, not signed-in nav',
  '/forgot-password': 'auth route reached via a login-page link, not signed-in nav',
  '/login': 'auth route, precedes any signed-in nav',
  '/reset-password': 'auth route reached via an email link, not signed-in nav',
  '/verify-email': 'auth route reached via an email link, not signed-in nav',
  '/select-school': 'tenant/role switcher, reached before the staff sidebar itself renders',
  '/i/$token': 'invitation-accept route reached via a tokenized email link, not signed-in nav',

  // Guardian portal — its own nav (`ui`'s portal shell), not the staff
  // sidebar `nav-tree.ts` describes.
  '/portal/': 'guardian portal home, has its own portal nav, not the staff sidebar',
  '/portal/account': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/attendance': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/calendar': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/fees': 'guardian portal page, has its own portal nav, not the staff sidebar',

  // Platform admin — its own nav, out of scope for the staff sidebar.
  '/_platform/holiday-sets/': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/holiday-sets/$setId': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/$schoolId': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/new': 'platform admin page, has its own nav, not the staff sidebar',

  // Staff routes reached from elsewhere in the UI, not their own sidebar item.
  '/_staff/notifications': 'reached from the header notification bell, not the sidebar',
  '/_staff/security': 'reached from the account menu, not the sidebar',
  '/_staff/academic-years/$academicYearId': 'detail route reached from the academic years list',
  '/_staff/attendance/$sectionId': 'detail route reached from the attendance list',
  '/_staff/calendar/import': 'action reached from the calendar page, not its own nav item',
  '/_staff/classes/$classId': 'detail route reached from the classes list',
  '/_staff/grading-scales/$scaleId': 'detail route reached from the grading scales list',
  '/_staff/guardians/$guardianId': 'detail route reached from the guardians list',
  '/_staff/routines/$sectionId': 'detail route reached from the routine builder section list',
  '/_staff/routines/review':
    '[21.9.1] reached via the "Open my routine"/"Copy last year\'s routine" palette actions and from the routine builder, not its own sidebar item',
  '/_staff/routines/substitutions':
    '[21.9.1] reached via the "Add substitution" palette action, not its own sidebar item',
  '/_staff/invoices/$invoiceId': 'detail route reached from the invoices list',
  '/_staff/payments/':
    '[16.4.4] placeholder page for the Record Payment modal, reached via /payments/record, not its own nav item',
  '/_staff/payments/$id': 'detail route reached from the payments list',
  '/_staff/staff/$userId': 'detail route reached from the staff list',
  '/_staff/students/$studentId': 'detail route reached from the students list',
  '/_staff/students/$studentId_/edit': 'action reached from the student detail page',
  '/_staff/students/import': 'action reached from the students list, not its own nav item',
  '/_staff/students/new': 'action reached from the students list, not its own nav item',
  '/_staff/communications/batches/$batchId': 'detail route reached from the batches list',
  '/_staff/fees/schedules/$id': 'detail route reached from the schedules list',
};
