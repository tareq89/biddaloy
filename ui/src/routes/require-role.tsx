import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { getActiveRole } from '../api/auth-state';

export interface RequireRoleProps {
  /** Roles allowed through. The caller's active role — set via
   * `setActiveRole()`/`auth-state.ts`, the same value `apiClient` sends as
   * `X-Role` — must be one of these, or the route redirects instead of
   * rendering `children`. */
  allow: readonly string[];
  /** Where an unauthorized caller lands. Defaults to `/forbidden` rather
   * than silently rendering nothing, so a mis-scoped route fails loudly
   * during development instead of looking like a blank page bug. */
  redirectTo?: string;
  children: ReactNode;
}

/**
 * Client-side route gating — a UX nicety, **not** the security boundary.
 * The server's own guard stack (`AuthGuard('jwt')`, `ContextGuard`,
 * `RolesGuard` — see `server/README`'s "Adding a new controller" section)
 * is what actually enforces access; this only avoids flashing a page the
 * API would reject anyway. A caller who bypasses this component still
 * hits the same 401/403 the server would always return.
 *
 * Redirects with `replace` (not a pushed entry) so the unauthorized route
 * doesn't sit in back-navigation history — pressing Back from the
 * redirect target shouldn't be able to land back on a page that never
 * actually rendered.
 */
export function RequireRole({ allow, redirectTo = '/forbidden', children }: RequireRoleProps) {
  const role = getActiveRole();
  const location = useLocation();

  if (!role || !allow.includes(role)) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  return children;
}
