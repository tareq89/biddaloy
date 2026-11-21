import { DAILY_LIMIT_REACHED, type DailyLimitsToday } from '@biddaloy/shared';
import { ApiError, apiClient } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/** [Epic 60 #3994] The one query key; a send's `onSuccess` invalidates it so the line refreshes. */
export const DAILY_LIMIT_TODAY_KEY = ['daily-limits-today'] as const;

/** Call after a send so the "left today" line shows the new number. */
export function useRefreshLeftToday() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: DAILY_LIMIT_TODAY_KEY });
}

/** The refusal sentence for a 409 `DAILY_LIMIT_REACHED` (numbers from `error.details`), else `undefined`. */
export function useDailyLimitMessage() {
  const { t } = useTranslation('communications');
  const config = useTenantRegionConfig();
  return (error: unknown): string | undefined => {
    if (!(error instanceof ApiError) || error.statusCode !== 409) return undefined;
    const details = error.details;
    if (details?.['code'] !== DAILY_LIMIT_REACHED) return undefined;
    const n = (key: string) => formatNumber(Number(details[key] ?? 0), config);
    return Number(details['remaining']) > 0
      ? t('dailyLimit.batchTooBig', { requested: n('requested'), remaining: n('remaining') })
      : t('dailyLimit.none', { limit: n('limit') });
  };
}

/** Optional "left today" line (D33): nothing unless the school switched it on and the channel is listed. */
export function LeftTodayLine({ channel }: { channel: 'sms' | 'email' | 'whatsapp' | undefined }) {
  const { t } = useTranslation('communications');
  const config = useTenantRegionConfig();
  const query = useQuery({
    queryKey: DAILY_LIMIT_TODAY_KEY,
    queryFn: async ({ signal }) =>
      (await apiClient.get<DailyLimitsToday>('/communications/daily-limits/today', { signal }))
        .data,
    staleTime: 0,
    retry: shouldRetryQuery,
  });
  const row = channel ? query.data?.channels[channel] : undefined;
  if (!query.data?.show || !row) return null;
  return (
    <p className="text-caption text-text-secondary">
      {t('dailyLimit.leftToday', {
        remaining: formatNumber(row.left, config),
        limit: formatNumber(row.limit, config),
      })}
    </p>
  );
}
