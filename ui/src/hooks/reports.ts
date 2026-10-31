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

// ---------------------------------------------------------------------------
// [8.15.17] "Download everything that matches" on the six list screens
// ---------------------------------------------------------------------------

export type ListExportFormat = 'xlsx' | 'csv';

/** The six `GET <list>/export` routes (8.15.11). Each takes its list's own query plus `format`. */
export type ListExportPath =
  | '/students/export'
  | '/guardians/export'
  | '/invoices/export'
  | '/fees/dues/export'
  | '/payments/export'
  | '/audit-logs/export';

/** The server's synchronous export cap (more rows answer HTTP 413, `EXPORT_TOO_LARGE`). */
export const SYNC_EXPORT_MAX_ROWS = 5_000;

/**
 * More matching rows than one download holds. `rows` is the cap, not the number of matches.
 * Carries the machine code so a UI component can recognise it without importing this module.
 */
export class ExportTooLargeError extends Error {
  readonly code = 'EXPORT_TOO_LARGE' as const;
  readonly rows: number;

  constructor(rows: number = SYNC_EXPORT_MAX_ROWS) {
    super('EXPORT_TOO_LARGE');
    this.name = 'ExportTooLargeError';
    this.rows = rows;
  }
}

/** Keys an export never sends: it is every match, so the list's paging does not apply. */
const EXPORT_IGNORED_KEYS = new Set(['page', 'limit', 'format']);

function toExportParams(filters: object, format: ListExportFormat): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (EXPORT_IGNORED_KEYS.has(key)) continue;
    if (typeof value === 'string' && value !== '') params[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') params[key] = String(value);
  }
  params.format = format.toUpperCase();
  return params;
}

function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** Reads a 413 body (a `Blob`, since the request asked for one) and says whether it is `EXPORT_TOO_LARGE`. */
async function tooLargeFromBody(body: unknown): Promise<ExportTooLargeError | null> {
  try {
    const text = body instanceof Blob ? await body.text() : JSON.stringify(body);
    const details = (JSON.parse(text) as { details?: { code?: unknown; rows?: unknown } }).details;
    if (details?.code !== 'EXPORT_TOO_LARGE') return null;
    return new ExportTooLargeError(typeof details.rows === 'number' ? details.rows : undefined);
  } catch {
    return null;
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // A later tick: Safari aborts an in-flight download if the URL is revoked in the same one.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads every row that matches `filters` as Excel or CSV, through `apiClient` (a plain link
 * cannot carry the bearer and tenant headers). Throws `ExportTooLargeError` on HTTP 413
 * `EXPORT_TOO_LARGE`; any other failure is the usual `ApiError` / `Error` from `apiClient`.
 *
 * `validateStatus` lets the 413 resolve so its JSON body can be read: with `responseType: 'blob'`
 * a rejected response's body would be an unreadable blob that `apiClient` replaces with a generic
 * "too large to upload" error.
 */
export async function downloadListExport(
  path: ListExportPath,
  /** The list's own query (any of the list hooks' filter shapes); unset and empty values are dropped. */
  filters: object,
  format: ListExportFormat,
): Promise<void> {
  const res = await apiClient.get<Blob>(path, {
    params: toExportParams(filters, format),
    responseType: 'blob',
    validateStatus: (status) => (status >= 200 && status < 300) || status === 413,
  });
  if (res.status === 413) {
    throw (await tooLargeFromBody(res.data)) ?? new Error('Export refused (413)');
  }
  const blob =
    res.data instanceof Blob
      ? res.data
      : new Blob([res.data], {
          type: format === 'csv' ? 'text/csv' : 'application/octet-stream',
        });
  const base = path.split('/').filter(Boolean).slice(0, -1).pop() ?? 'export';
  saveBlob(
    blob,
    filenameFromContentDisposition(
      res.headers['content-disposition'] as string | undefined,
      `${base}.${format}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// [8.15.54] Early BANBEIS student count (temporary — 8.15.32 replaces it)
// ---------------------------------------------------------------------------

export type StudentCountResponse = S['StudentCountDto'];
export type StudentCountRow = S['StudentCountRowDto'];
export type StaffCountRow = S['StaffCountRowDto'];

export const studentCountKeys = createEntityKeys<{ academic_year_id?: string }>('student-count');

/** `GET /reports/student-count` — the current year when no year is given. */
export function studentCountQueryOptions(academicYearId?: string) {
  return queryOptions({
    queryKey: studentCountKeys.list(academicYearId ? { academic_year_id: academicYearId } : {}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentCountResponse>('/reports/student-count', {
        params: academicYearId ? { academic_year_id: academicYearId } : {},
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudentCount(academicYearId?: string) {
  return useQuery(studentCountQueryOptions(academicYearId));
}

/** `GET /reports/student-count/export` — the class table or the staff table, as Excel or CSV. */
export async function downloadStudentCountExport(options: {
  academicYearId?: string;
  format?: ListExportFormat;
  table?: 'students' | 'staff';
}): Promise<void> {
  const format = options.format ?? 'xlsx';
  const table = options.table ?? 'students';
  const res = await apiClient.get<Blob>('/reports/student-count/export', {
    params: {
      ...(options.academicYearId ? { academic_year_id: options.academicYearId } : {}),
      format: format.toUpperCase(),
      table,
    },
    responseType: 'blob',
  });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
  saveBlob(
    blob,
    filenameFromContentDisposition(
      res.headers['content-disposition'] as string | undefined,
      `student-count-${table}.${format}`,
    ),
  );
}
