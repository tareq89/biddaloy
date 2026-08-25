import { useSearch } from '@tanstack/react-router';

import { useSearchNavigate } from './navigate-search';

/**
 * "Page, filters, sort, selected row and active tab all live in the query
 * string" — [8.4.5]'s stated platform principle, made concrete: the one
 * hook every list page reads/writes its `page`/`limit`/`sort`/filter state
 * through, so Back works, refresh survives, and a link is shareable
 * without the page component keeping any of that in local state.
 *
 * [8.9.1] ported this off react-router's `useSearchParams` onto
 * `@tanstack/react-router`'s `useSearch`/`useNavigate`, called with
 * `strict: false` since this hook has no fixed route id — any list page,
 * on any route, can use it. A route that declares its own Zod
 * `validateSearch` gets typed values here for free; a route that doesn't
 * still gets the same defensive fallback this hook always had, since
 * `useSearch({ strict: false })` can hand back an unvalidated, possibly
 * malformed value either way.
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
  /** Same convention as `sort`/`order` above: a string sets the param and
   * `null` removes it. Removal has to be explicit — an *absent* key leaves
   * the param untouched, so a "clear this filter" control must pass `null`
   * rather than dropping the key from the object, or the old value survives
   * in the URL and the list stays filtered with no way back. */
  filters?: Record<string, string | null>;
}

const RESERVED_KEYS = new Set(['page', 'limit', 'sort', 'order']);

/** A search param the URL controls has to survive being hand-edited,
 * bookmarked from an old session, or passed a garbage value by a bug
 * upstream — `?page=abc` or `?page=-3` must fall back to a sensible
 * default rather than propagating `NaN`/a negative offset into a list
 * query. Takes `unknown`, not `string | null`: TanStack Router's default
 * search codec runs each value through `JSON.parse`, so `?page=2` can
 * arrive already as the number `2` rather than the string `"2"`.
 * `Number.isInteger` — not just `Number.isFinite` — also rejects
 * `?page=1.5`, which parses to a technically-finite but meaningless page
 * number. */
function parsePositiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStringEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

export function useListUrlState(
  defaults: { page?: number; limit?: number } = {},
): [ListUrlState, (patch: ListUrlStatePatch) => void] {
  // No fixed route id — this hook is meant to work from any list page, so
  // it reads whatever the currently matched route(s) expose rather than
  // demanding a specific one be registered.
  const search = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const navigateSearch = useSearchNavigate();

  const page = parsePositiveInt(search.page, defaults.page ?? 1);
  const limit = parsePositiveInt(search.limit, defaults.limit ?? 10);
  const sort = typeof search.sort === 'string' ? search.sort : undefined;
  const order = parseStringEnum(search.order, ['asc', 'desc'] as const) ?? 'asc';

  // Reserved keys can arrive JSON-parsed into non-strings too (a filter
  // value of `9` instead of `'9'`) — re-stringify on read so callers keep
  // the `Record<string, string>` contract regardless of how the URL codec
  // round-tripped it.
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(search)) {
    if (RESERVED_KEYS.has(key) || value === undefined) continue;
    filters[key] =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
  }

  function update(patch: ListUrlStatePatch): void {
    navigateSearch((prev) => {
      const next: Record<string, unknown> = { ...prev };
      if (patch.page !== undefined) next.page = patch.page;
      if (patch.limit !== undefined) next.limit = patch.limit;
      if (patch.sort === null) delete next.sort;
      else if (patch.sort !== undefined) next.sort = patch.sort;
      if (patch.order === null) delete next.order;
      else if (patch.order !== undefined) next.order = patch.order;
      if (patch.filters !== undefined) {
        for (const [key, value] of Object.entries(patch.filters)) {
          // A caller-supplied filter key of 'page'/'limit'/'sort' would
          // otherwise run after (and silently win over) the explicit
          // patch.page/limit/sort updates above.
          if (RESERVED_KEYS.has(key)) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
      }
      return next;
    });
  }

  return [{ page, limit, sort, order, filters }, update];
}
