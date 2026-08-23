import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Invoice = components['schemas']['Invoice'];
export type CreateInvoiceInput = components['schemas']['CreateInvoiceDto'];
export type InvoiceStatus = Invoice['status'];

/** `search` lives in the filter shape (not a separate key namespace) so
 * [8.9.9]'s global-search palette and [8.10.6]'s invoices list page share
 * one `lists()` invalidation target instead of drifting into two.
 * `status`/`from_date`/`to_date` are [8.10.6]'s own additions — `findAll`
 * (`invoices.controller.ts`) already accepted them, this type just hadn't
 * caught up since no caller needed them until now. */
export interface InvoiceListFilters {
  search?: string;
  student_id?: string;
  status?: InvoiceStatus;
  from_date?: string;
  to_date?: string;
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

/** [8.10.2]'s Invoices tab — `GET /invoices?student_id=` — and [8.10.6]'s
 * tenant-wide `/invoices` list both share `invoiceKeys.list(filters)` with
 * [8.9.9]'s global-search palette, so a mutation that invalidates
 * `invoiceKeys.lists()` invalidates every one of them. */
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

/**
 * Opens `GET /invoices/:id/print`'s server-rendered HTML in a new tab —
 * the acceptance criterion behind both [8.10.2]'s Invoices tab and
 * [8.10.6]'s invoices list ("layout never re-implemented client-side").
 * There's deliberately no client-side print *route*: rendering the
 * server's HTML string into a React tree (`dangerouslySetInnerHTML`) is
 * strictly worse than opening it as its own document — a second XSS
 * surface for zero benefit — and still wouldn't satisfy "renders outside
 * the app shell" as directly as a real new tab does.
 *
 * `apiClient` attaches the Authorization header itself (`api/client.ts`'s
 * request interceptor) — a plain `<a href>` to the API origin wouldn't
 * carry it and the printable route would 401. A 403 (invoice outside the
 * caller's tenant) or a network failure rejects the request — `onError`
 * surfaces that instead of leaving the click looking like a no-op.
 *
 * The tab is opened *before* the `await`, still inside the click's user-
 * activation window — opening it only after the request resolves is
 * outside that window, so a browser's popup blocker can silently drop it
 * (`window.open` returning `null` with no error). `.opener` is cleared by
 * hand instead of passing `noopener`/`noreferrer` to `window.open` — per
 * MDN, either one implies the other, and passing it makes `window.open`
 * itself always return `null` (the new window is deliberately
 * unreachable), which would make every call look like a blocked popup
 * and also drop the reference this needs to navigate later.
 */
export async function openPrintableInvoice(invoiceId: string, onError: () => void): Promise<void> {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    onError();
    return;
  }
  printWindow.opener = null;

  try {
    const res = await apiClient.get<string>(`/invoices/${invoiceId}/print`, {
      responseType: 'text',
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
    printWindow.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    printWindow.close();
    onError();
  }
}
