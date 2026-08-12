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
