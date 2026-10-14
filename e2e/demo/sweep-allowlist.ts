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
  // No row link at the small demo scale (0.05 x 2 years); verify on a full-scale run.
  '/academics/study-plans/$planId',
  '/print-templates/$templateId/edit',
  '/applications/$applicationId',
  '/my-class/$sectionId',
];
