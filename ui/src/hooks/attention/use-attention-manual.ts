import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getManualAlerts,
  previewManualAlert,
  sendManualAlert,
  withdrawManualAlert,
  type CreateManualAlertInput,
  type ManualAudience,
} from '../../api/attention';
import { createEntityKeys } from '../query-keys';
import { shouldRetryQuery } from '../retry';

import { attentionKeys } from './use-attention-queries';

export const manualAlertKeys = createEntityKeys<{ page?: number; pageSize?: number }>(
  'attention-manual',
);

/** At least one audience group has a value. */
export function isAudienceEmpty(a: ManualAudience): boolean {
  return ![a.roles, a.sectionIds, a.userIds, a.guardiansOfSectionIds].some((g) => g?.length);
}

export function useManualAlerts(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: manualAlertKeys.list(params),
    queryFn: ({ signal }) => getManualAlerts(params, signal),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

function useRefreshAfterManualWrite() {
  const queryClient = useQueryClient();
  // The sender may be a recipient, so the bar and worklist refresh too.
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: manualAlertKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
    ]);
}

export function useSendManualAlert() {
  const refresh = useRefreshAfterManualWrite();
  return useMutation({
    mutationFn: (body: CreateManualAlertInput) => sendManualAlert(body),
    onSuccess: refresh,
  });
}

export function useWithdrawManualAlert() {
  const refresh = useRefreshAfterManualWrite();
  return useMutation({
    mutationFn: (id: string) => withdrawManualAlert(id),
    onSuccess: refresh,
  });
}

/** The caller debounces `audience` (300 ms) before passing it. */
export function useManualAlertPreview(audience: ManualAudience) {
  return useQuery({
    queryKey: ['attention-manual', 'preview', audience] as const,
    queryFn: ({ signal }) => previewManualAlert(audience, signal),
    enabled: !isAudienceEmpty(audience),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}
