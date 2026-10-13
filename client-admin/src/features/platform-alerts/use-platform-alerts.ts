import { ApiError, apiClient, type components } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';

export type PlatformAlerts = components['schemas']['PlatformAlertsDto'];

/** Polls `GET /platform/alerts` every 30 s (matches the server probe, D15).
 * A failed poll keeps the last answer: React Query holds `data` on error.
 * A 403 stops the polling: a school-local SUPER_ADMIN is not a platform one,
 * and asking again every 30 s would only repeat the 403. */
export function usePlatformAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['platform-alerts'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<PlatformAlerts>('/platform/alerts', { signal })).data,
    refetchInterval: (query) =>
      query.state.error instanceof ApiError && query.state.error.statusCode === 403
        ? false
        : 30_000,
    refetchIntervalInBackground: false,
    retry: shouldRetryQuery,
    enabled,
  });
}
