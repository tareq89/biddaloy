import { Permission, ROLE_PERMISSIONS, UserRole } from '@biddaloy/shared';

import { getActiveRole } from '../api/auth-state';

/**
 * Pure predicate half of permission-gating — `ROLE_PERMISSIONS` (shared
 * with the server, `@biddaloy/shared`) is the single source of truth for
 * which roles hold which permission, so a nav item hidden here and a
 * route guarded server-side never drift into disagreeing about who can
 * do what. An unrecognized role string (a future role the client hasn't
 * been updated for, or simply `null`) has no entry in `ROLE_PERMISSIONS`
 * and is treated as holding nothing, not everything — fail closed.
 */
export function hasPermission(role: string | null, permission: Permission): boolean {
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role as UserRole];
  return permissions?.includes(permission) ?? false;
}

/**
 * Reads the active role from `auth-state.ts` on every render — like the
 * rest of that module (see its own comment), this is **not** reactive:
 * a role change elsewhere doesn't itself trigger a re-render of a
 * component that already read this hook. That's fine for a role set once
 * at login/tenant-switch and otherwise stable for the component's
 * lifetime (this app's current maturity level — see `auth-state.ts`);
 * a future real state layer can make this reactive without changing the
 * hook's signature.
 *
 * This is a **UX** gate only, exactly like `RequireRole` — it decides
 * what's shown, not what's allowed. The server's own `@Roles`/RolesGuard
 * checks (and, for schools/settings specifically,
 * `assertCanManageSchool`) are the actual security boundary.
 */
export function useHasPermission(permission: Permission): boolean {
  return hasPermission(getActiveRole(), permission);
}
