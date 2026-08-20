import type { QueryClient } from '@tanstack/react-query';

import { setActiveRole, setActiveTenant } from '../api/auth-state';
import { persistTenant } from '../api/tenant-storage';

/**
 * The one blessed way to switch the active tenant. Calling
 * `setActiveTenant` directly leaves every cached query keyed under the
 * previous tenant sitting in the cache — `auth-state.ts` is deliberately
 * state-management-agnostic (see its own comment) and holds no
 * `QueryClient` reference, so nothing about setting a new tenant ID
 * clears anything on its own. Left uncleared, switching schools can
 * render one school's cached students/fees/invoices under the new
 * tenant's name for however long `staleTime` allows before a real
 * refetch happens — the highest-stakes cache bug this ticket exists to
 * prevent.
 *
 * `queryClient.clear()`, not a targeted `invalidateQueries`: every
 * cached query in this app is tenant-scoped server state (nothing
 * cached today is global/tenant-agnostic), so a full clear is both
 * correct and simpler than maintaining a list of what to invalidate as
 * more entities' hooks get added.
 */
export function switchActiveTenant(
  queryClient: QueryClient,
  tenantId: string,
  role?: string,
): void {
  setActiveTenant(tenantId);
  if (role !== undefined) {
    setActiveRole(role);
  }
  // [8.9.5]'s "choice survives reload" — `session.ts`'s cold-boot bootstrap
  // reads this back to restore the same tenant next visit.
  persistTenant(tenantId);
  queryClient.clear();
}
