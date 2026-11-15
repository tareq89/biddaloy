/**
 * [3.x/#3988] bKash online payments: the guardian starts one and polls its result; staff list the
 * ONLINE rows; an admin tests the saved credentials. Rule 25: every mutation is `retry: false`
 * and the start sends an `Idempotency-Key`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { type ProofReviewFilters, usePaymentSubmissions } from './payment-submissions';
import { shouldRetryQuery } from './retry';

type Schemas = components['schemas'];
export type StartOnlinePaymentResponse = Schemas['StartOnlinePaymentResponseDto'];
export type OnlinePaymentResult = Schemas['OnlinePaymentResultDto'];
export type BkashTestResponse = Schemas['BkashTestResponseDto'];

/** Result polling stops once the payment left PENDING. */
export const ONLINE_RESULT_POLL_MS = 3000;

/** Guardian: start a bKash payment for the picked bills; send them to `bkashUrl`. */
export function useStartOnlinePayment() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (billIds: string[]) => {
      const body = { billIds };
      return (
        await apiClient.post<StartOnlinePaymentResponse>('/portal/online-payments', body, {
          headers: { 'Idempotency-Key': keyFor(body) },
        })
      ).data;
    },
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: ['fees'] });
    },
    retry: false,
  });
}

/** Guardian: how the payment ended. Polls while PENDING (the callback may arrive late). */
export function useOnlinePaymentResult(id: string | undefined, { enabled = true } = {}) {
  return useQuery({
    enabled: enabled && !!id,
    queryKey: ['payment-submissions', 'online-result', id ?? null] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<OnlinePaymentResult>(`/portal/online-payments/${id}`, { signal })).data,
    retry: shouldRetryQuery,
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' ? ONLINE_RESULT_POLL_MS : false,
  });
}

/** Staff: the ONLINE rows of the shared payment-submissions list. */
export function useOnlinePaymentSubmissions(
  filters: Omit<ProofReviewFilters, 'source'> = {},
  options: { enabled?: boolean } = {},
) {
  return usePaymentSubmissions({ ...filters, source: 'ONLINE' }, options);
}

/** Admin: token-grant test of the saved bKash credentials. Not an idempotent write. */
export function useTestBkashConnection() {
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<BkashTestResponse>('/settings/payments/bkash/test')).data,
    retry: false,
  });
}
