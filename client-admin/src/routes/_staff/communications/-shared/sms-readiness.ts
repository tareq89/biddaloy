import { apiClient } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';

/** [78 D37] What `GET /communications/sms-credits/readiness` answers. A local
 * literal type rather than `components['schemas']`: the generated schema is
 * regenerated separately from this hook. */
export type SmsReadiness = 'READY' | 'NO_GATEWAY' | 'NO_CREDIT';

/** [78 D38] Fails open: while loading or on error there is no warning, and
 * the caller never blocks a send on this answer. */
export function useSmsReadiness(enabled = true) {
  return useQuery({
    queryKey: ['sms-readiness'],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ sms: SmsReadiness }>('/communications/sms-credits/readiness', {
          signal,
        })
      ).data,
    enabled,
    staleTime: 60_000,
    retry: shouldRetryQuery,
  });
}
