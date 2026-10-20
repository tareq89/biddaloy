import { SeatOrderStatus, type BillingSummary, type SeatOrderDto } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type { BillingSummary, SeatOrderDto };

export interface CreateSeatOrderInput {
  seats: number;
  months: number;
  /** One per dialog open; a retry reuses it so a dropped response never makes a second order. */
  idempotency_key: string;
}

export const billingKeys = createEntityKeys<Record<string, never>>('billing');

/** `GET /billing/summary` — seats bought/used, paid-until and the latest orders. Active school only. */
export function billingSummaryQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.list({}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<BillingSummary>('/billing/summary', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** `pollWhilePending`: refetch every 3 s until that order is no longer PENDING (the bKash return page). */
export function useBillingSummary(pollWhilePending?: string) {
  return useQuery({
    ...billingSummaryQueryOptions(),
    refetchInterval: (q) =>
      pollWhilePending &&
      q.state.data?.orders.find((o) => o.id === pollWhilePending)?.status ===
        SeatOrderStatus.PENDING
        ? 3000
        : false,
  });
}

/** `POST /billing/orders/:id/pay/bkash` — the bKash checkout URL for a PENDING order. */
export function usePayWithBkash() {
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiClient.post<{ bkash_url: string }>(
        `/billing/orders/${orderId}/pay/bkash`,
      );
      return res.data;
    },
    retry: false,
  });
}

/** `POST /billing/orders` — a PENDING order; pay it with `usePayWithBkash`. */
export function useCreateSeatOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSeatOrderInput) => {
      const res = await apiClient.post<SeatOrderDto>('/billing/orders', input);
      return res.data;
    },
    // Not `shouldRetryQuery`: the caller retries with the same idempotency key on purpose.
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}
