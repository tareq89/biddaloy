import { Permission, ROLE_PERMISSIONS, UserRole } from '@biddaloy/shared';

import { useActiveRole } from './auth-state';

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
 * Reads the active role via `useActiveRole()` (`hooks/auth-state.ts`'s
 * `useSyncExternalStore` subscriber over `api/auth-state.ts`) — a tenant
 * switch that changes the active role now re-renders every consumer of
 * this hook, including a nav item whose visibility depends on it.
 *
 * This is a **UX** gate only, exactly like `RequireRole` — it decides
 * what's shown, not what's allowed. The server's own `@Roles`/RolesGuard
 * checks (and, for schools/settings specifically,
 * `assertCanManageSchool`) are the actual security boundary.
 */
export function useHasPermission(permission: Permission): boolean {
  const role = useActiveRole();
  return hasPermission(role, permission);
}
