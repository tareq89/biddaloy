import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type PaletteSearchStudent = components['schemas']['SearchStudentResult'];
export type PaletteSearchGuardian = components['schemas']['SearchGuardianResult'];
export type PaletteSearchStaff = components['schemas']['SearchStaffResult'];
export type PaletteSearchInvoice = components['schemas']['SearchInvoiceResult'];
export type PaletteSearchPayment = components['schemas']['SearchPaymentResult'];

/** A jump-to palette, not a list page — matches the server's own default
 * (`SearchQueryDto.limit`, `search.dto.ts`), hard-capped at 10 there. */
const PALETTE_SEARCH_LIMIT = 5;

const paletteSearchKeys = createEntityKeys<{ q: string }>('palette-search');

export interface PaletteSearchResults {
  students: readonly PaletteSearchStudent[];
  guardians: readonly PaletteSearchGuardian[];
  staff: readonly PaletteSearchStaff[];
  invoices: readonly PaletteSearchInvoice[];
  payments: readonly PaletteSearchPayment[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * [30.5.1] People tab data source for `CommandPalette` — one round trip
 * against `GET /search` (30.2.1), not the five parallel per-entity
 * requests `useGlobalSearch` fired before this endpoint existed. The
 * server now decides which of the five groups the caller may see at all
 * (a group absent from the response means "no permission", not "empty" —
 * see `search.dto.ts`'s `SearchResultsDto` comment), so this hook does no
 * client-side permission gating of its own; a missing key on the
 * response just degrades to an empty array here.
 *
 * `query` is expected to already be debounced by the caller (same
 * division of labour as the old `useGlobalSearch`) — this hook only
 * forwards the debounced value into the query key and the request. The
 * `signal` forwarded into `apiClient` is what makes TanStack Query abort
 * a still-in-flight request automatically when a new keystroke changes
 * the query key before the previous request resolves.
 */
export function usePaletteSearch(query: string): PaletteSearchResults {
  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const result = useQuery(
    queryOptions({
      queryKey: paletteSearchKeys.list({ q: trimmed }),
      queryFn: async ({ signal }) => {
        const res = await apiClient.get<components['schemas']['SearchResultsDto']>('/search', {
          params: { q: trimmed, limit: PALETTE_SEARCH_LIMIT },
          signal,
        });
        return res.data;
      },
      enabled,
      retry: shouldRetryQuery,
    }),
  );

  return {
    students: result.data?.students ?? [],
    guardians: result.data?.guardians ?? [],
    staff: result.data?.staff ?? [],
    invoices: result.data?.invoices ?? [],
    payments: result.data?.payments ?? [],
    isLoading: enabled && result.isLoading,
    isError: result.isError,
  };
}
