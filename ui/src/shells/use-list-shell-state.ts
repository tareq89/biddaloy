/**
 * Wires `useListUrlState` ([8.4.x]) into exactly what `ListShell`/
 * `DataTable` need: a `DataTableSort` (not a bare `sort` string) and a
 * selection set — both round-tripped through the URL, same as
 * page/limit/filters, so "all list state lives in the URL" holds for
 * selection too, not just filters. Selection reuses the generic
 * `filters` bag under a reserved `selected` key (comma-joined IDs)
 * rather than extending `useListUrlState` itself — that hook has no
 * concept of "selection", and every other consumer of it (a future detail
 * page's tabs, say) shouldn't have to carry that shape.
 *
 * Filter changes reset to page 1 automatically — the issue's own
 * acceptance criterion — by always patching `page: 1` alongside a
 * `setFilters` call; nothing computed here, just an explicit, always-on
 * default a caller has no chance to forget.
 */
import type { DataTableSort } from '../components/data-table';
import { useListUrlState } from '../routes/use-list-url-state';

const SELECTED_KEY = 'selected';

export interface ListShellState {
  page: number;
  limit: number;
  sorting: DataTableSort | null;
  filters: Record<string, string>;
  selectedIds: ReadonlySet<string>;
}

export interface ListShellActions {
  setPage: (page: number) => void;
  setSorting: (sorting: DataTableSort | null) => void;
  setFilters: (filters: Record<string, string>) => void;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
}

export function useListShellState(
  defaults: { limit?: number } = {},
): [ListShellState, ListShellActions] {
  const [urlState, updateUrl] = useListUrlState(defaults);

  const selectedRaw = urlState.filters[SELECTED_KEY];
  const selectedIds = new Set(selectedRaw ? selectedRaw.split(',').filter(Boolean) : []);

  const filters = { ...urlState.filters };
  delete filters[SELECTED_KEY];

  const sorting: DataTableSort | null = urlState.sort
    ? { id: urlState.sort, desc: urlState.order === 'desc' }
    : null;

  return [
    { page: urlState.page, limit: urlState.limit, sorting, filters, selectedIds },
    {
      setPage: (page) => updateUrl({ page }),
      setSorting: (next) => {
        if (next) {
          updateUrl({ sort: next.id, order: next.desc ? 'desc' : 'asc', page: 1 });
        } else {
          updateUrl({ sort: null, order: null, page: 1 });
        }
      },
      setFilters: (nextFilters) => {
        // selectedIds lives in the same bag under SELECTED_KEY — carry the
        // current selection forward rather than clearing it, since a
        // filter change and a selection change are independent actions.
        updateUrl({
          filters: { ...nextFilters, ...(selectedRaw ? { [SELECTED_KEY]: selectedRaw } : {}) },
          page: 1,
        });
      },
      setSelectedIds: (ids) => {
        updateUrl({ filters: { ...filters, [SELECTED_KEY]: Array.from(ids).join(',') } });
      },
    },
  ];
}
