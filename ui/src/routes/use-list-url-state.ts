import { useSearchParams } from 'react-router';

/**
 * "Page, filters, sort, selected row and active tab all live in the query
 * string" — [8.4.5]'s stated platform principle, made concrete: the one
 * hook every list page reads/writes its `page`/`limit`/`sort`/filter state
 * through, so Back works, refresh survives, and a link is shareable
 * without the page component keeping any of that in local state.
 */
export interface ListUrlState {
  page: number;
  limit: number;
  sort: string | undefined;
  /** `asc` for anything other than the literal string `'desc'` — a typed
   * two-value column, not a free-form param, since a `DataTableSort` has
   * nothing meaningful a third value could mean. */
  order: 'asc' | 'desc';
  /** Every search param that isn't `page`/`limit`/`sort`/`order` —
   * arbitrary caller-defined filters (`class_id`, `enrollment_status`,
   * ...), generic here since this hook has no knowledge of a specific
   * entity's filter shape. */
  filters: Record<string, string>;
}

export interface ListUrlStatePatch {
  page?: number;
  limit?: number;
  /** `undefined` leaves the param untouched, a string sets it, `null`
   * removes it — `sort`/`order` are the only params a caller can clear
   * (a "clear sort" action needs the param gone, not set to `''`), since
   * page/limit/filters always have a meaningful value to fall back to. */
  sort?: string | null;
  order?: 'asc' | 'desc' | null;
  filters?: Record<string, string>;
}

const RESERVED_KEYS = new Set(['page', 'limit', 'sort', 'order']);

/** A search param the URL controls has to survive being hand-edited,
 * bookmarked from an old session, or passed a garbage value by a bug
 * upstream — `?page=abc` or `?page=-3` must fall back to a sensible
 * default rather than propagating `NaN`/a negative offset into a list
 * query. `Number.isInteger` — not just `Number.isFinite` — also rejects
 * `?page=1.5`, which parses to a technically-finite but meaningless page
 * number. */
function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function useListUrlState(
  defaults: { page?: number; limit?: number } = {},
): [ListUrlState, (patch: ListUrlStatePatch) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parsePositiveInt(searchParams.get('page'), defaults.page ?? 1);
  const limit = parsePositiveInt(searchParams.get('limit'), defaults.limit ?? 10);
  const sort = searchParams.get('sort') ?? undefined;
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const filters: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!RESERVED_KEYS.has(key)) filters[key] = value;
  }

  function update(patch: ListUrlStatePatch): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (patch.page !== undefined) next.set('page', String(patch.page));
      if (patch.limit !== undefined) next.set('limit', String(patch.limit));
      if (patch.sort === null) next.delete('sort');
      else if (patch.sort !== undefined) next.set('sort', patch.sort);
      if (patch.order === null) next.delete('order');
      else if (patch.order !== undefined) next.set('order', patch.order);
      if (patch.filters !== undefined) {
        for (const [key, value] of Object.entries(patch.filters)) {
          // A caller-supplied filter key of 'page'/'limit'/'sort' would
          // otherwise run after (and silently win over) the explicit
          // patch.page/limit/sort updates above.
          if (RESERVED_KEYS.has(key)) continue;
          next.set(key, value);
        }
      }
      return next;
    });
  }

  return [{ page, limit, sort, order, filters }, update];
}
