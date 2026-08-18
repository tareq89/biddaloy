import { useNavigate } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';

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
 * Redirects via an explicit `useEffect`, not a rendered `<Navigate>` —
 * `<Navigate>` re-runs its own internal effect on every re-render of the
 * element that creates it, and `RequireRole` re-renders on every router
 * state change (it reads the active role fresh each time), which turned
 * an unauthorized visit into an infinite `navigate()` loop in testing.
 * The `useEffect` here has `[authorized, redirectTo, navigate]` as its
 * dependency array, so it fires exactly once per real change instead of
 * once per render. Redirects with `replace` (not a pushed entry) so the
 * unauthorized route doesn't sit in back-navigation history — pressing
 * Back from the redirect target shouldn't be able to land back on a page
 * that never actually rendered.
 */
export function RequireRole({ allow, redirectTo = '/forbidden', children }: RequireRoleProps) {
  const role = getActiveRole();
  const authorized = Boolean(role) && allow.includes(role as string);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authorized) void navigate({ to: redirectTo, replace: true });
  }, [authorized, redirectTo, navigate]);

  if (!authorized) return null;
  return children;
}
