/**
 * Query-key factory convention for `@biddaloy/ui`. Every entity's keys
 * follow the same hierarchical shape (the widely-used TanStack Query
 * "as many levels as you need" pattern):
 *
 *   all        -> ['students']
 *   lists()    -> ['students', 'list']
 *   list(f)    -> ['students', 'list', { page: 1 }]
 *   details()  -> ['students', 'detail']
 *   detail(id) -> ['students', 'detail', id]
 *
 * The hierarchy is what makes invalidation precise. Invalidating
 * `lists()` refetches every list variant (any filter/page combination)
 * without touching cached detail queries; invalidating `all` clears
 * everything for that entity. A flat key (`['students', page]`) can't
 * make either distinction — invalidating one list either misses sibling
 * filter variants or over-invalidates queries that have nothing to do
 * with the change.
 *
 * `createEntityKeys(entity)` builds this shape for any entity name —
 * see `./students.ts`'s `studentKeys` for the reference instance every
 * other entity's key factory should mirror.
 */
export interface EntityKeys<TFilters, TId> {
  all: readonly [string];
  lists: () => readonly [string, 'list'];
  list: (filters?: TFilters) => readonly [string, 'list', TFilters | Record<string, never>];
  details: () => readonly [string, 'detail'];
  detail: (id: TId) => readonly [string, 'detail', TId];
}

export function createEntityKeys<TFilters = Record<string, unknown>, TId = string>(
  entity: string,
): EntityKeys<TFilters, TId> {
  return {
    all: [entity] as const,
    lists: () => [entity, 'list'] as const,
    list: (filters) => [entity, 'list', filters ?? {}] as const,
    details: () => [entity, 'detail'] as const,
    detail: (id) => [entity, 'detail', id] as const,
  };
}

/** [pr-fix #1035] The server caps every list endpoint's `limit` at 100
 * (`@Max(100)`), so a "just raise the limit" fix for a picker with >100
 * options doesn't work — this fetches every page and concatenates them.
 * Page 1 runs first (to learn `totalPages`), the rest run in parallel. Only
 * for reference-list pickers (Combobox options) where the whole list is
 * genuinely needed client-side, not for a paged `DataTable`. */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; totalPages: number }>,
): Promise<T[]> {
  const first = await fetchPage(1);
  if (first.totalPages <= 1) {
    return first.data;
  }
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, i) => fetchPage(i + 2)),
  );
  return [first.data, ...rest.map((page) => page.data)].flat();
}
