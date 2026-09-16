/**
 * [16.6.4] Collections report — `GET /reports/collections` (JSON summary)
 * and `GET /reports/collections.csv` (same query, CSV download).
 *
 * HAND-TYPED CONTRACT — pending #671 (w6-g2) merge + `schema.d.ts` regen.
 * `CollectionsReportResponse` below is typed by hand against the
 * dispatch-provided shape rather than `components['schemas'][...]`
 * because `schema.d.ts` doesn't carry these routes yet. Diff this against
 * the generated types once #671 lands and fold it into `schema.d.ts`'s
 * `components['schemas']` the same way every other hook in this
 * directory does — do not leave it hand-typed longer than necessary.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export interface CollectionsReportFilters {
  from: string;
  to: string;
  method?: string;
  collector_id?: string;
}

export interface CollectionsReportTotals {
  collected: number;
  reversed: number;
  net: number;
  standing_discount: number;
  one_off_discount: number;
  wallet_used: number;
  wallet_added: number;
  change_returned: number;
}

export interface CollectionsByMethod {
  method: string;
  amount: number;
  count: number;
}

export interface CollectionsByCollector {
  collector_id: string;
  collector_name: string;
  amount: number;
  count: number;
}

export interface CollectionsByFeeType {
  fee_type: string;
  amount: number;
  count: number;
}

export interface CollectionsByDay {
  date: string;
  amount: number;
}

export interface CollectionsReportResponse {
  range: { from: string; to: string };
  totals: CollectionsReportTotals;
  by_method: CollectionsByMethod[];
  by_collector: CollectionsByCollector[];
  by_fee_type: CollectionsByFeeType[];
  by_day: CollectionsByDay[];
}

export const collectionsReportKeys = createEntityKeys<CollectionsReportFilters>(
  'reports-collections',
);

function toParams(filters: CollectionsReportFilters): Record<string, string> {
  const params: Record<string, string> = { from: filters.from, to: filters.to };
  if (filters.method !== undefined) params.method = filters.method;
  if (filters.collector_id !== undefined) params.collector_id = filters.collector_id;
  return params;
}

export function collectionsReportQueryOptions(filters: CollectionsReportFilters) {
  return queryOptions({
    queryKey: collectionsReportKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<CollectionsReportResponse>('/reports/collections', {
        params: toParams(filters),
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCollectionsReport(filters: CollectionsReportFilters) {
  return useQuery(collectionsReportQueryOptions(filters));
}

/**
 * Fetches `/reports/collections.csv` through `apiClient` (so it carries
 * the same bearer-token/tenant headers every other request does — a
 * plain `<a href>` to this URL cannot, since auth here is a header set by
 * `apiClient`'s interceptor, not a cookie; see `ui/src/api/client.ts`)
 * and saves the response the same blob-URL way `ui/src/utils/csv.ts`'s
 * `downloadCsv` does for client-built CSVs.
 */
export async function downloadCollectionsReportCsv(
  filters: CollectionsReportFilters,
): Promise<void> {
  const res = await apiClient.get<Blob>('/reports/collections.csv', {
    params: toParams(filters),
    responseType: 'blob',
  });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `collections-${filters.from}-to-${filters.to}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
