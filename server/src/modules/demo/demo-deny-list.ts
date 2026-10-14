/**
 * Routes that stay closed in the demo (D23, D42). Paths are matched against the request path
 * with the `/api` prefix and the `/v<n>` version stripped, e.g. `/backup/restore`.
 * Add a route here and `demo-mode.guard.spec.ts` picks it up (one test row per entry).
 */
export interface DemoDenyEntry {
  method: string;
  pathPattern: RegExp;
  /** One line, shown nowhere to visitors; kept so a reviewer knows why the route is closed. */
  reason: string;
  /** A concrete matching path, used by the spec. */
  example: string;
}

export const DEMO_DENY_LIST: readonly DemoDenyEntry[] = [
  {
    method: 'POST',
    pathPattern: /^\/backup\/restore$/,
    reason: 'a restore would replace the demo data',
    example: '/backup/restore',
  },
  {
    method: 'POST',
    pathPattern: /^\/backup\/validate$/,
    reason: 'workbook import: visitors cannot load their own data',
    example: '/backup/validate',
  },
  {
    method: 'POST',
    pathPattern: /^\/students\/bulk-upload\/(validate|commit)$/,
    reason: 'bulk student upload',
    example: '/students/bulk-upload/commit',
  },
  {
    method: 'POST',
    pathPattern: /^\/students\/photos\/bulk$/,
    reason: 'bulk photo upload',
    example: '/students/photos/bulk',
  },
  {
    method: 'POST',
    pathPattern: /^\/users\/bulk-upload\/(validate|commit)$/,
    reason: 'bulk staff upload',
    example: '/users/bulk-upload/validate',
  },
  {
    method: 'POST',
    pathPattern: /^\/homework\/bulk\/(validate|commit)$/,
    reason: 'bulk homework upload',
    example: '/homework/bulk/commit',
  },
  {
    method: 'POST',
    pathPattern: /^\/calendar-import\/(validate|commit)$/,
    reason: 'calendar import',
    example: '/calendar-import/commit',
  },
  {
    method: 'POST',
    pathPattern: /^\/study-plans\/import\/(validate|commit)$/,
    reason: 'study plan import',
    example: '/study-plans/import/commit',
  },
  {
    method: 'DELETE',
    pathPattern: /(^|\/)bulk(\/|-|$)/,
    reason: 'bulk delete',
    example: '/students/bulk-delete',
  },
  {
    method: 'POST',
    pathPattern: /(^|\/)bulk[-/]?delete/,
    reason: 'bulk delete',
    example: '/students/bulk-delete',
  },
  {
    method: 'DELETE',
    pathPattern: /^\/academic-years\/[^/]+$/,
    reason: 'deleting the academic year breaks every demo page',
    example: '/academic-years/3f1b2c4d-0000-4000-8000-000000000000',
  },
  {
    method: 'DELETE',
    pathPattern: /^\/users\/[^/]+$/,
    reason: 'removing a member could remove a demo login',
    example: '/users/3f1b2c4d-0000-4000-8000-000000000000',
  },
  {
    method: 'PATCH',
    pathPattern: /^\/schools\/[^/]+\/(status|trial)$/,
    reason: 'suspend / trial danger zone',
    example: '/schools/3f1b2c4d-0000-4000-8000-000000000000/status',
  },
  {
    method: 'POST',
    pathPattern: /^\/users\/me\/leave$/,
    reason: 'a visitor could end a demo login by leaving its school',
    example: '/users/me/leave',
  },
  {
    method: 'POST',
    pathPattern: /^\/users\/[^/]+\/reset-password$/,
    reason: 'an admin reset logs out every visitor on that card',
    example: '/users/3f1b2c4d-0000-4000-8000-000000000000/reset-password',
  },
  {
    method: 'POST',
    pathPattern: /^\/schools\/[^/]+\/settings\/test$/,
    reason: 'provider connection test would call real hosts with visitor-typed credentials',
    example: '/schools/3f1b2c4d-0000-4000-8000-000000000000/settings/test',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/change-password$/,
    reason: 'the shared demo password must not change',
    example: '/auth/change-password',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/(forgot-password|reset-password)$/,
    reason: 'no password resets in the demo',
    example: '/auth/forgot-password',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/(step-up\/)?otp\/request$/,
    reason: 'would send a real OTP',
    example: '/auth/otp/request',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/register\/start$/,
    reason: 'new schools cannot be created in the demo',
    example: '/auth/register/start',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/register\/resend$/,
    reason: 'new schools cannot be created in the demo',
    example: '/auth/register/resend',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/register\/verify$/,
    reason: 'new schools cannot be created in the demo',
    example: '/auth/register/verify',
  },
  {
    method: 'POST',
    pathPattern: /^\/auth\/social\/[^/]+\/link-start$/,
    reason: "would attach a visitor's real account to a shared card",
    example: '/auth/social/google/link-start',
  },
  {
    method: 'DELETE',
    pathPattern: /^\/auth\/social\/identities\/[^/]+$/,
    reason: 'sign-in methods of a shared card must not change',
    example: '/auth/social/identities/google',
  },
];

export function findDenied(method: string, path: string): DemoDenyEntry | undefined {
  // Express routes case-insensitively, so match on the lower-cased path.
  const normalized =
    path
      .toLowerCase()
      .replace(/^\/api(\/v\d+)?/, '')
      .replace(/\/+$/, '') || '/';
  return DEMO_DENY_LIST.find(
    (e) => e.method === method.toUpperCase() && e.pathPattern.test(normalized),
  );
}
