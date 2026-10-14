/**
 * [58.4.02] Console errors the nightly demo sweep tolerates. Every entry needs a reason.
 * Keep it empty unless a message is known and harmless.
 */
export const CONSOLE_ERROR_ALLOWLIST: { pattern: RegExp; reason: string }[] = [];

/**
 * Routes whose error boundary is a known app bug that must not block the nightly swap forever.
 * `path` is the manifest path. Each entry names the issue; delete it when the issue is fixed.
 */
export const KNOWN_ISSUES: { path: string; reason: string }[] = [
  {
    path: '/attendance/staff',
    reason:
      'principal, accountant, teacher, exam controller and office staff hold STAFF_ATTENDANCE_READ but not USER_READ; the page loads GET /users (403) and shows the error state. Filed by the 58.4.02 report.',
  },
];
