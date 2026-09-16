import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient, getPublicInvoice as apiGetPublicInvoice } from '../api/client';
import type { components } from '../api/schema';
import { toast } from '../components/toast';
import { useTranslation } from '../i18n';
import type { InvoicePrintFormat } from '../utils/invoice-print-format';

import type { Guardian } from './guardians';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { studentQueryOptions } from './students';

export type Invoice = components['schemas']['Invoice'];
export type CreateInvoiceInput = components['schemas']['CreateInvoiceDto'];
export type InvoiceStatus = Invoice['status'];

// ---- interim types: #664–#667 invoice snapshot / share / send ----
// Hand-rolled: `schema.d.ts` isn't regenerated for the w5-g1 lane's server
// contract yet (#664–#667 unmerged). Delete this banner's contents the
// next time `schema.d.ts` is regenerated and replace every reference with
// the generated type — same reconciliation seam `payments.ts`'s own
// `// ---- interim types: #659 ----` banner documents.
export type InvoiceKind = 'INVOICE' | 'CREDIT_NOTE';

/** #666's snapshot fields, layered on top of the generated `Invoice` —
 * every field optional so a pre-#664 response (no `kind`/`snapshot`) still
 * type-checks and renders unchanged. */
export type InvoiceWithSnapshot = Invoice & {
  kind?: InvoiceKind;
  related_invoice_id?: string | null;
};

export interface InvoiceShareToken {
  id: string;
  revoked_at: string | null;
  last_viewed_at?: string | null;
  view_count?: number;
  url?: string;
}

export interface CreateInvoiceShareResult {
  url: string;
  token_id: string;
}

export type SendInvoiceMedium = 'WHATSAPP' | 'SMS';

export interface SendInvoiceInput {
  medium: SendInvoiceMedium;
  guardian_id?: string;
}

/** Re-exported from `ui/src/api/client.ts` — that file owns the canonical
 * shape (it's where `getPublicInvoice`'s response is typed) so this and
 * the request function can never drift out of sync with each other. */
export type { PublicInvoiceReceipt } from '../api/client';

/** `search` lives in the filter shape (not a separate key namespace) so
 * [8.9.9]'s global-search palette and [8.10.6]'s invoices list page share
 * one `lists()` invalidation target instead of drifting into two.
 * `status`/`from_date`/`to_date` are [8.10.6]'s own additions — `findAll`
 * (`invoices.controller.ts`) already accepted them, this type just hadn't
 * caught up since no caller needed them until now. */
// [8.14.10] `min_amount`/`max_amount`/`sort`/`order` mirror `QueryInvoiceDto`
// (`server/src/modules/invoices/dto/invoices.dto.ts`), landed by #373 but
// never threaded through this hand-written filter type until now.
export interface InvoiceListFilters {
  search?: string;
  student_id?: string;
  status?: InvoiceStatus;
  from_date?: string;
  to_date?: string;
  min_amount?: number;
  max_amount?: number;
  sort?: 'issued_date' | 'due_date' | 'total_amount' | 'invoice_number' | 'status';
  order?: 'asc' | 'desc';
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
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useInvoices(filters: InvoiceListFilters = {}) {
  return useQuery(invoicesQueryOptions(filters));
}

/** [8.14.5]'s route-loader recipe needs a `queryOptions` factory it can
 * pass straight to `queryClient.ensureQueryData` from `_staff/invoices/
 * $invoiceId.tsx`'s `loader` — extracted out of `useInvoice` below rather
 * than inlined there so both call sites share one `queryKey`/`queryFn`,
 * same reason `invoicesQueryOptions` above already exists. Behaviour-
 * preserving: `useInvoice` is now a one-line wrapper around this. */
export function invoiceQueryOptions(id: string) {
  return queryOptions({
    queryKey: invoiceKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Invoice>(`/invoices/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useInvoice(id: string) {
  return useQuery(invoiceQueryOptions(id));
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
 *
 * [16.5.5] extended with `format` (`?format=<a4|pos58|pos80>`, #665) and
 * auto-print: `printWindow.onload` fires `print()` itself so a counter
 * clerk printing dozens of POS receipts a day doesn't need to reach for
 * Ctrl/Cmd+P every time. `onload` is set *before* `location.href` so it
 * can't race a load that finishes first. Best-effort only — `print()` can
 * throw in a browser that blocks it, and the user can still fall back to
 * Ctrl/Cmd+P by hand, so failures here are swallowed rather than routed
 * through `onError`. Does **not** shorten the 60s `revokeObjectURL`
 * timeout above: revoking the blob URL before the print dialog has read
 * it produces a blank page.
 */
export async function openPrintableInvoice(
  invoiceId: string,
  onError: () => void,
  format: InvoicePrintFormat = 'a4',
): Promise<void> {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    onError();
    return;
  }
  printWindow.opener = null;

  try {
    const res = await apiClient.get<string>(`/invoices/${invoiceId}/print?format=${format}`, {
      responseType: 'text',
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
    printWindow.onload = () => {
      try {
        printWindow.print();
      } catch {
        // Best-effort — the user can still print by hand (Ctrl/Cmd+P).
      }
    };
    printWindow.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    printWindow.close();
    onError();
  }
}

/**
 * Thin wrapper the two [16.5.5] call sites (invoice detail, checkout
 * success) share, so neither duplicates the `toast.error` handler around
 * `openPrintableInvoice`. Replaces the ticket body's `usePrintUrl` —
 * see this file's own `openPrintableInvoice` comment for why a plain
 * URL/`<a href>` hook can't work here (no `Authorization` header).
 */
export function usePrintInvoice() {
  const { t } = useTranslation('fees');
  return (invoiceId: string, format: InvoicePrintFormat = 'a4') =>
    void openPrintableInvoice(invoiceId, () => toast.error(t('invoiceDetail.printError')), format);
}

/** #666 `POST /invoices/:id/share` — mints a new public share link.
 * Invalidates both the invoice detail (share-token count/state may be
 * reflected there) and this invoice's share-list key so "Copy link"
 * appears immediately without a manual refetch. */
export function useShareInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiClient.post<CreateInvoiceShareResult>(`/invoices/${invoiceId}/share`);
      return { invoiceId, result: res.data };
    },
    onSuccess: ({ invoiceId }) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
      void queryClient.invalidateQueries({
        queryKey: [...invoiceKeys.detail(invoiceId), 'shares'],
      });
    },
  });
}

/** #666 `GET /invoices/:id/share` — every share token minted for this
 * invoice, live and revoked. "Copy link"/"Revoke" only render once a live
 * (non-revoked) token exists — see `$invoiceId.tsx`'s use of this. */
export function invoiceSharesQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...invoiceKeys.detail(id), 'shares'] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const res = await apiClient.get<InvoiceShareToken[] | { data: InvoiceShareToken[] }>(
        `/invoices/${id}/share`,
        { signal },
      );
      // #666's response envelope wasn't nailed down at plan time — accept
      // either a bare array or `{ data: [...] }` so this doesn't need a
      // follow-up edit once the server lane lands; re-check against the
      // real contract when #666 merges.
      return Array.isArray(res.data) ? res.data : res.data.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useInvoiceShares(id: string) {
  return useQuery(invoiceSharesQueryOptions(id));
}

/** #666 `DELETE /invoices/:id/share/:tokenId` — revokes a live share
 * link; the public page then 404s/410s for anyone still holding the URL. */
export function useRevokeShare(invoiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      await apiClient.delete(`/invoices/${invoiceId}/share/${tokenId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
      void queryClient.invalidateQueries({
        queryKey: [...invoiceKeys.detail(invoiceId), 'shares'],
      });
    },
  });
}

/** #667 `POST /invoices/:id/send` — dispatches the receipt to a guardian
 * over WhatsApp or SMS. A distinct `SMS_NO_CREDIT` `ApiError.message` is
 * the server's way of saying the tenant is out of SMS credit — callers
 * check `error.message` / `error.details` to show that distinctly from a
 * generic failure toast, same pattern as every other `ApiError` consumer
 * in this codebase (there's no machine-readable error code field beyond
 * `message`, see `api/errors.ts`'s own header comment). */
export function useSendInvoice(invoiceId: string) {
  return useMutation({
    mutationFn: async (input: SendInvoiceInput) => {
      await apiClient.post(`/invoices/${invoiceId}/send`, input);
    },
  });
}

/** [#664 review] Guardians who could receive an invoice's send/receipt —
 * every student on a (possibly multi-student, siblings-in-one-checkout)
 * invoice, not just the one `invoice.student`/`payment.student` column
 * happens to point at. `$invoiceId.tsx` and `checkout-success.tsx` both
 * used to derive this from a single `useStudent(...)` call each, missing
 * guardians linked only to a non-primary sibling on the invoice.
 *
 * Reachable = `notifications_enabled`; preferred = reachable *and*
 * `is_primary_contact`, falling back to every reachable guardian when
 * none is primary — same two-step filter both call sites already used,
 * just applied per student and then deduped by guardian id (a guardian
 * shared across siblings, e.g. one parent for two children on the same
 * invoice, must appear once, not once per student). */
export function useInvoiceSendCandidates(studentIds: string[]) {
  const queries = useQueries({
    queries: studentIds.map((id) => studentQueryOptions(id)),
  });

  const isPending = queries.some((q) => q.isPending);
  const guardiansById = new Map<string, Guardian>();
  for (const query of queries) {
    for (const guardian of query.data?.guardians ?? []) {
      guardiansById.set(guardian.id, guardian);
    }
  }
  const allGuardians = [...guardiansById.values()];
  const reachableGuardians = allGuardians.filter((guardian) => guardian.notifications_enabled);
  const primaryGuardians = reachableGuardians.filter((guardian) => guardian.is_primary_contact);
  const sendCandidates = primaryGuardians.length > 0 ? primaryGuardians : reachableGuardians;

  return { isPending, sendCandidates };
}

/** [16.5.5] `GET /public/invoices/:token` — the chrome-free receipt page a
 * guardian opens from a shared link, with no session at all. Deliberately
 * **not** under `invoiceKeys`: this is a different audience reading a
 * different endpoint that staff-side mutations never need to invalidate,
 * so a literal key keeps it out of `invoiceKeys.all`'s blast radius. */
export function usePublicInvoice(token: string) {
  return useQuery({
    queryKey: ['public-invoice', token] as const,
    queryFn: ({ signal }) => apiGetPublicInvoice(token, signal),
    retry: shouldRetryQuery,
    staleTime: 5 * 60 * 1000,
  });
}
