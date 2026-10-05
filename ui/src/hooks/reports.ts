/** Collections report — `GET /reports/collections` (JSON) and `.csv` (same query). Types come from `schema.d.ts`. */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components, operations } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type CollectionsReportResponse = S['CollectionsReportDto'];
export type CollectionsReportTotals = S['CollectionsReportTotals'];
export type CollectionsByMethod = S['CollectionsByMethod'];
export type CollectionsByCollector = S['CollectionsByCollector'];
export type CollectionsByFeeType = S['CollectionsByFeeType'];
export type CollectionsByDay = S['CollectionsByDay'];
export type CollectionsReportFilters =
  operations['ReportsController_getCollections_v1']['parameters']['query'];

export const collectionsReportKeys =
  createEntityKeys<CollectionsReportFilters>('reports-collections');

function toParams(filters: CollectionsReportFilters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
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
