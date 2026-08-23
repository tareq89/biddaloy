import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Invoice = components['schemas']['Invoice'];
export type CreateInvoiceInput = components['schemas']['CreateInvoiceDto'];

/** `search` lives in the filter shape (not a separate key namespace) so
 * [8.9.9]'s global-search palette and a future invoices list page share
 * one `lists()` invalidation target instead of drifting into two. */
export interface InvoiceListFilters {
  search?: string;
  student_id?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedInvoices {
  data: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const invoiceKeys = createEntityKeys<InvoiceListFilters>('invoices');

/** [8.10.2]'s Invoices tab — `GET /invoices?student_id=` — shares
 * `invoiceKeys.list(filters)` with [8.9.9]'s global-search palette and
 * any future tenant-wide invoices list ([8.10.6]), so a mutation that
 * invalidates `invoiceKeys.lists()` invalidates this too. */
export function invoicesQueryOptions(filters: InvoiceListFilters = {}) {
  return queryOptions({
    queryKey: invoiceKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedInvoices>('/invoices', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useInvoices(filters: InvoiceListFilters = {}) {
  return useQuery(invoicesQueryOptions(filters));
}

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

/** [8.10.4]'s dues queue "Generate Invoice" bulk action — one call per
 * selected student. Deliberately **no `onMutate`**: this creates a real
 * financial document, the same "never optimistic" case `payments.ts`'s
 * `useCreatePayment` documents (and the `no-optimistic-financial-mutation`
 * ESLint rule enforces) — an invoice appearing in the UI before the
 * server confirms it exists would misrepresent what's actually been
 * billed if the request fails. */
export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const res = await apiClient.post<Invoice>('/invoices', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
    },
  });
}
