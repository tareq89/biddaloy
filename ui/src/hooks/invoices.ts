import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Invoice = components['schemas']['Invoice'];

/** `search` lives in the filter shape (not a separate key namespace) so
 * [8.9.9]'s global-search palette and a future invoices list page share
 * one `lists()` invalidation target instead of drifting into two. */
export interface InvoiceListFilters {
  search?: string;
  student_id?: string;
  page?: number;
  limit?: number;
}

export const invoiceKeys = createEntityKeys<InvoiceListFilters>('invoices');

export function useInvoice(id: string) {
  return useQuery(
    queryOptions({
      queryKey: invoiceKeys.detail(id),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<Invoice>(`/invoices/${id}`, { signal });
        return res.data;
      },
      retry: shouldRetryQuery,
    }),
  );
}
