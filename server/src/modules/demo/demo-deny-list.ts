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
  // Messages stay in Mailpit (see communications/providers/communication-provider.registry.ts),
  // so opening register and OTP sends nothing real. Password recovery and social linking stay closed (88.1.02 review).
  // Bulk routes are capped by the row limit, not denied.
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
  // No bulk delete route exists today; these keep any future one closed on the demo.
  {
    method: 'DELETE',
    pathPattern: /(^|\/)bulk(\/|-|$)/,
    reason: 'bulk delete (none today; a future one stays closed)',
    example: '/students/bulk-delete',
  },
  {
    method: 'POST',
    pathPattern: /(^|\/)bulk[-/]?delete/,
    reason: 'bulk delete (none today; a future one stays closed)',
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
    reason: 'the reset link lands in the public inbox: a visitor could take over a shared card',
    example: '/auth/forgot-password',
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
