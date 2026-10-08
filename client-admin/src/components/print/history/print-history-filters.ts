import { DocumentKind } from '@biddaloy/shared';
import type { PrintHistoryFilters } from '@biddaloy/ui/hooks';
import { z } from 'zod';

/**
 * [32.3.5] The print history's URL search params, in the shape of
 * `audit-logs/index.tsx`: every field `.catch(undefined)`, so a hand-edited or
 * stale URL falls back to "no filter" instead of taking the page down.
 *
 * The ROUTE (32.4.1) owns `validateSearch` and passes the parsed search in, so
 * the components here never import a route (D60).
 */
const isRealCalendarDate = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(d.getTime()) &&
    d.toISOString().startsWith(value)
  );
};

export const printHistorySearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  // The server caps every list at 100.
  limit: z.number().int().min(1).max(100).optional().catch(undefined),
  document_kind: z.enum(DocumentKind).optional().catch(undefined),
  template_id: z.string().optional().catch(undefined),
  printed_by: z.string().optional().catch(undefined),
  from: z.string().refine(isRealCalendarDate).optional().catch(undefined),
  to: z.string().refine(isRealCalendarDate).optional().catch(undefined),
  outcome: z.enum(['PENDING', 'OK', 'FAILED']).optional().catch(undefined),
  // In the URL as text ('true' / 'false') so the filter bar's select can carry it.
  revoked: z.enum(['true', 'false']).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export type PrintHistorySearch = z.infer<typeof printHistorySearchSchema>;

/** The filter keys the FilterBar edits (everything except paging). */
export const FILTER_KEYS = [
  'document_kind',
  'template_id',
  'printed_by',
  'from',
  'to',
  'outcome',
  'revoked',
  'q',
] as const;

/** The FilterBar's own shape: string values only. */
export function filterValues(search: PrintHistorySearch): Record<string, string> {
  return Object.fromEntries(
    FILTER_KEYS.flatMap((key) => (search[key] !== undefined ? [[key, search[key]]] : [])),
  );
}

/** The query parameters `usePrintHistory` sends. */
export function toHistoryFilters(search: PrintHistorySearch): PrintHistoryFilters {
  return {
    page: search.page ?? 1,
    limit: search.limit ?? 25,
    ...(search.document_kind !== undefined ? { document_kind: search.document_kind } : {}),
    ...(search.template_id !== undefined ? { template_id: search.template_id } : {}),
    ...(search.printed_by !== undefined ? { printed_by: search.printed_by } : {}),
    ...(search.from !== undefined ? { from: search.from } : {}),
    ...(search.to !== undefined ? { to: search.to } : {}),
    ...(search.outcome !== undefined ? { outcome: search.outcome } : {}),
    ...(search.revoked !== undefined ? { revoked: search.revoked === 'true' } : {}),
    ...(search.q !== undefined && search.q !== '' ? { q: search.q } : {}),
  };
}
