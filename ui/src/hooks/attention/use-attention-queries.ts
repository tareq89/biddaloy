import { useQuery } from '@tanstack/react-query';

import {
  getAttentionItems,
  getAttentionSummary,
  getPlatformAttentionHealth,
  getStudentAttention,
  type AttentionItemsQuery,
} from '../../api/attention';
import { useLocale } from '../../i18n';
import { useActiveRole } from '../auth-state';
import { createEntityKeys } from '../query-keys';
import { shouldRetryQuery } from '../retry';

/** [67.2.01] Everything starts with `'attention'`, so invalidating `all`
 * refreshes the bar, the worklist and the student strip at once. */
export const attentionKeys = {
  ...createEntityKeys<AttentionItemsQuery>('attention'),
  summary: (role: string, locale: string) => ['attention', 'summary', role, locale] as const,
  student: (id: string, locale: string) => ['attention', 'student', id, locale] as const,
  platformHealth: () => ['attention', 'platform-health'] as const,
};

// D18: refresh on focus and every 5 minutes (not while the tab is hidden).
const LIVE = {
  refetchOnWindowFocus: true,
  refetchInterval: 5 * 60_000,
  refetchIntervalInBackground: false,
} as const;

/** Shell chrome: never throws; disabled until a role is active (D15). */
export function useAttentionSummary() {
  const role = useActiveRole();
  const { locale } = useLocale();
  return useQuery({
    queryKey: attentionKeys.summary(role ?? '', locale),
    queryFn: ({ signal }) => getAttentionSummary({ role: role ?? '', locale }, signal),
    enabled: role !== null,
    throwOnError: false,
    retry: shouldRetryQuery,
    ...LIVE,
  });
}

export function useAttentionItems(query: AttentionItemsQuery, { enabled = true } = {}) {
  const { locale } = useLocale();
  const params = { ...query, locale: query.locale ?? locale };
  return useQuery({
    queryKey: attentionKeys.list(params),
    queryFn: ({ signal }) => getAttentionItems(params, signal),
    enabled,
    placeholderData: (prev) => prev,
    retry: shouldRetryQuery,
    ...LIVE,
  });
}

export function useStudentAttention(studentId: string | undefined) {
  const { locale } = useLocale();
  return useQuery({
    queryKey: attentionKeys.student(studentId ?? '', locale),
    queryFn: ({ signal }) => getStudentAttention(studentId ?? '', locale, signal),
    enabled: Boolean(studentId),
    throwOnError: false,
    retry: shouldRetryQuery,
  });
}

/** SUPER_ADMIN watches this live (D12). */
export function usePlatformAttentionHealth() {
  return useQuery({
    queryKey: attentionKeys.platformHealth(),
    queryFn: ({ signal }) => getPlatformAttentionHealth(signal),
    refetchInterval: 60_000,
    retry: shouldRetryQuery,
  });
}
