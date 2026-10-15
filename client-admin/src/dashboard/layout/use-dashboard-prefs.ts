/**
 * [169.2-10] Read the active role's saved dashboard layout from
 * `GET /users/me` (no separate read route) and save it with
 * `PATCH /users/me/preferences/dashboard` (D34).
 */
import type { DashboardLayoutPref, DashboardPreferences, UserRole } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  currentUserQueryOptions,
  shouldRetryQuery,
  useActiveRole,
  userKeys,
} from '@biddaloy/ui/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** D32: every widget data hook spreads this. */
export const dashboardQueryOptions = {
  refetchOnWindowFocus: true,
  refetchInterval: 5 * 60_000,
  retry: shouldRetryQuery,
} as const;

export function useDashboardPrefs() {
  const role = useActiveRole() as UserRole | null;
  const user = useQuery(currentUserQueryOptions());
  const all = (user.data?.preferences as { dashboard?: DashboardPreferences } | null)?.dashboard;
  // A failed read leaves `pref` undefined, so the page shows the role default.
  return { role, pref: role ? all?.[role] : undefined, isLoading: user.isLoading };
}

export function useSaveDashboardPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pref: DashboardLayoutPref) =>
      (await apiClient.patch<DashboardLayoutPref>('/users/me/preferences/dashboard', pref)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.detail('me') }),
  });
}
