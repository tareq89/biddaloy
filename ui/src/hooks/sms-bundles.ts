import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { smsCreditsKeys } from './sms-credits';

// The 200 bodies of these routes are untyped in schema.d.ts (`content?: never`), so the shapes
// below are copied from the server DTOs (`sms-bundle-catalog.dto.ts`, `sms-bundle-orders.dto.ts`).
export interface SmsPackage {
  id: string;
  name: string;
  smsCount: number;
  validityDays: number;
  pricePaisa: string;
  priceTaka: string;
  active: boolean;
}

export interface SmsBundleOrder {
  id: string;
  packageId: string;
  name: string;
  smsCount: number;
  validityDays: number;
  pricePaisa: string;
  costPaisaPerSms: string | null;
  status: string;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

export type SmsSource = components['schemas']['SmsSourceDto'];
export type SetSmsSourceInput = components['schemas']['SetSmsSourceDto'];

export const smsBundleKeys = createEntityKeys<{ page: number; limit: number } | undefined>(
  'sms-bundles',
);
const smsSourceKeys = createEntityKeys<Record<string, never>>('sms-source');

/** `GET /sms-bundles/catalog` — packages on sale, cheapest first. */
export function useSmsBundleCatalog() {
  return useQuery(
    queryOptions({
      queryKey: [...smsBundleKeys.all, 'catalog'],
      queryFn: async ({ signal }) =>
        (await apiClient.get<SmsPackage[]>('/sms-bundles/catalog', { signal })).data,
      retry: shouldRetryQuery,
    }),
  );
}

/** `GET /sms-bundles/orders` — newest first. The server pages by `offset`; `page` is 1-based. */
export function useSmsBundleOrders(page = 1, limit = 20) {
  return useQuery(
    queryOptions({
      queryKey: smsBundleKeys.list({ page, limit }),
      queryFn: async ({ signal }) =>
        (
          await apiClient.get<SmsBundleOrder[]>('/sms-bundles/orders', {
            params: { limit: Math.min(limit, 100), offset: (page - 1) * limit },
            signal,
          })
        ).data,
      retry: shouldRetryQuery,
      placeholderData: (previous) => previous,
    }),
  );
}

function useInvalidateBundles() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: smsCreditsKeys.all });
    void queryClient.invalidateQueries({ queryKey: smsBundleKeys.all });
  };
}

/**
 * `POST /sms-bundles/orders` — a PENDING order. The `Idempotency-Key` is made once per mount (one
 * dialog open) and reused for every retry; it rotates after a success so reopening starts fresh.
 */
export function useCreateSmsBundleOrder() {
  const invalidate = useInvalidateBundles();
  const key = React.useRef<string | undefined>(undefined);
  return useMutation({
    mutationFn: async (input: { package_id: string }) => {
      key.current ??= crypto.randomUUID();
      const res = await apiClient.post<SmsBundleOrder>(
        '/sms-bundles/orders',
        { ...input, idempotency_key: key.current },
        { headers: { 'Idempotency-Key': key.current } },
      );
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      key.current = undefined;
      invalidate();
    },
  });
}

/** `POST /sms-bundles/orders/:id/pay/bkash` — the bKash checkout URL. */
export function usePaySmsBundleWithBkash() {
  const invalidate = useInvalidateBundles();
  return useMutation({
    mutationFn: async (orderId: string) =>
      (await apiClient.post<{ bkash_url: string }>(`/sms-bundles/orders/${orderId}/pay/bkash`))
        .data,
    retry: false,
    onSuccess: invalidate,
  });
}

/** `GET /communications/sms-source` — who sends this school's SMS. */
export function useSmsSource() {
  return useQuery(
    queryOptions({
      queryKey: smsSourceKeys.list({}),
      queryFn: async ({ signal }) =>
        (await apiClient.get<SmsSource>('/communications/sms-source', { signal })).data,
      retry: shouldRetryQuery,
    }),
  );
}

/** `PUT /communications/sms-source`. */
export function usePutSmsSource() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBundles();
  return useMutation({
    mutationFn: async (input: SetSmsSourceInput) =>
      (await apiClient.put<SmsSource>('/communications/sms-source', input)).data,
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: smsSourceKeys.all });
      invalidate();
    },
  });
}
