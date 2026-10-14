/**
 * [58.4.02] Console errors the nightly demo sweep tolerates. Every entry needs a reason.
 * Keep it empty unless a message is known and harmless.
 */
export const CONSOLE_ERROR_ALLOWLIST: { pattern: RegExp; reason: string }[] = [];

/**
 * Routes whose error boundary is a known app bug that must not block the nightly swap forever.
 * `path` is the manifest path; `roles` are the only roles tolerated (any other role still fails).
 * Each entry names the issue; delete it when the issue is fixed.
 */
export const KNOWN_ISSUES: { path: string; roles: string[]; reason: string }[] = [
  {
    path: '/attendance/staff',
    // EXECUTIVE = principal. Not ADMIN: it holds USER_READ, so a boundary there is a real regression.
    roles: ['EXECUTIVE', 'ACCOUNTANT', 'TEACHER', 'EXAM_CONTROLLER', 'OFFICE_STAFF'],
    reason:
      'principal, accountant, class teacher, exam controller and office staff hold STAFF_ATTENDANCE_READ but not USER_READ; the page loads GET /users (403) and shows the error state. Tracked in #2513.',
  },
];

/**
 * Detail routes the sweep may skip (no single list page to open a row from). Any other route
 * skipped fails the run, so an empty or broken list page cannot pass silently.
 */
export const EXPECTED_SKIPS: string[] = [
  '/marks/$examId/$sectionId/$subjectId',
  '/results/$examId/$studentId',
  '/staff/$userId/acr/$assessmentId',
];

/**
 * Detail routes with no row link at a small demo scale (0.05 x 2 years). Skipped only when the
 * seed ran below full scale (`DEMO_SCALE` < 1, which the nightly reset passes to the sweep); at full
 * scale an empty list page here fails the run like any other.
 */
export const SMALL_SCALE_SKIPS: string[] = [
  '/academics/study-plans/$planId',
  '/print-templates/$templateId/edit',
  '/applications/$applicationId',
  '/my-class/$sectionId',
];

/**
 * Manifest routes the sweep never visits, each with the reason. A staff route with no entry in
 * `route-permissions.ts`, no entry here and no public target in the spec fails the run before it
 * starts, so a new route is never dropped without a word.
 */
export const NOT_SWEPT: Record<string, string> = {
  '/': 'redirects to the role home, which the sweep visits',
  '/login': 'signed-out page',
  '/activate': 'signed-out page (needs an emailed token)',
  '/register': 'signed-out page',
  '/auth/social/done': 'signed-out redirect after a social sign-in',
  '/forgot-password': 'signed-out page',
  '/reset-password': 'signed-out page (needs an emailed token)',
  '/verify-email': 'signed-out page (needs an emailed token)',
  '/select-school': 'part of signing in (signIn passes through it)',
  '/schools': 'platform console: no demo card is a SUPER_ADMIN',
  '/schools/$schoolId': 'platform console: no demo card is a SUPER_ADMIN',
  '/schools/new': 'platform console: no demo card is a SUPER_ADMIN',
  '/holiday-sets': 'platform console: no demo card is a SUPER_ADMIN',
  '/holiday-sets/$setId': 'platform console: no demo card is a SUPER_ADMIN',
  '/i/$token': 'the seed stores only the share token hash, so no link can be rebuilt',
  '/v/$token': 'the seed stores only the ID card verify token hash, so no link can be rebuilt',
};
