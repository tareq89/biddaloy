import { ApiError, apiClient, type components } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';

export type PlatformAlerts = components['schemas']['PlatformAlertsDto'];

const forbidden = ({ state }: { state: { error: unknown } }) =>
  state.error instanceof ApiError && state.error.statusCode === 403;

/** Polls `GET /platform/alerts` every 30 s (matches the server probe, D15).
 * A failed poll keeps the last answer: React Query holds `data` on error.
 * A 403 means a school-local SUPER_ADMIN, not a platform one, so after it the
 * query stops asking: no 30 s poll, and no refetch on tab focus or on mount. */
export function usePlatformAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['platform-alerts'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<PlatformAlerts>('/platform/alerts', { signal })).data,
    refetchInterval: (query) => (forbidden(query) ? false : 30_000),
    refetchOnWindowFocus: (query) => !forbidden(query),
    refetchOnMount: (query) => !forbidden(query),
    refetchIntervalInBackground: false,
    retry: shouldRetryQuery,
    enabled,
  });
}
