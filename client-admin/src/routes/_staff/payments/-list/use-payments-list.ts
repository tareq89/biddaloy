import { apiClient } from '@biddaloy/ui/api';
import { paymentKeys, shouldRetryQuery, type Payment } from '@biddaloy/ui/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

export interface PaymentsListParams {
  page: number;
  limit: number;
  search?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  include_reversed?: boolean;
}

export interface PaymentsListResult {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
}

/**
 * `GET /payments` — the school-wide payment list. Keyed under
 * `paymentKeys.all` so `useCheckout` / `useReversePayment`'s invalidation
 * refreshes it. ponytail: route-local; move to `ui/src/hooks` when a second
 * screen needs it.
 */
export function usePaymentsList(params: PaymentsListParams) {
  return useQuery({
    queryKey: [...paymentKeys.all, 'school-list', params],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaymentsListResult>('/payments', { params, signal });
      return res.data;
    },
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}
