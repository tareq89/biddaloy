/**
 * Wires `useListUrlState` ([8.4.x]) into exactly what `ListShell`/
 * `DataTable` need: a `DataTableSort` (not a bare `sort` string) and a
 * selection set. Page, limit, sort and filters round-trip through the URL;
 * the selection does NOT — [2602] it is unbounded (hundreds of ids across
 * pages) and a long `?selected=` made a refresh fail with 431/414. It is
 * held in memory per tenant + path (`list-selection-memory.ts`): in-app Back
 * keeps it, a refresh drops it. A legacy `?selected=` link is ignored and
 * stripped.
 *
 * Filter changes reset to page 1 automatically — the issue's own
 * acceptance criterion — by always patching `page: 1` alongside a
 * `setFilters` call; nothing computed here, just an explicit, always-on
 * default a caller has no chance to forget.
 */
import { useLocation, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getActiveTenant } from '../api/auth-state';
import { getSelection, listSelectionKey, setSelection } from '../api/list-selection-memory';
import type { DataTableSort } from '../components/data-table';
import { useSearchNavigate } from '../routes/navigate-search';
import { useListUrlState } from '../routes/use-list-url-state';

/** Retired URL key; old bookmarks still carry it. */
const LEGACY_SELECTED_KEY = 'selected';

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
  /** A string sets a filter, `null` clears it — see `ListUrlStatePatch`. */
  setFilters: (filters: Record<string, string | null>) => void;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
  /** Rows-per-page control ([8.14.10]) — always resets to page 1, same
   * reasoning as `setFilters`: a caller has no chance to forget. */
  setLimit: (limit: number) => void;
}

export function useListShellState(
  defaults: { limit?: number } = {},
): [ListShellState, ListShellActions] {
  const [urlState, updateUrl] = useListUrlState(defaults);

  const navigateSearch = useSearchNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const key = listSelectionKey(pathname, getActiveTenant());
  const [held, setHeld] = useState(() => ({ key, ids: getSelection(key) }));
  // A different path or tenant starts from what is stored for it.
  const selectedIds = held.key === key ? held.ids : getSelection(key);

  // Raw search, not `urlState.filters`: on a route whose `validateSearch` does not
  // declare `selected`, filters no longer carry it (#2999), but the URL still does.
  const rawSearch = useSearch({ strict: false }) as unknown as Record<string, unknown>;
  const hasLegacy = rawSearch[LEGACY_SELECTED_KEY] !== undefined;
  useEffect(() => {
    if (!hasLegacy) return;
    navigateSearch(
      (prev) => {
        const rest = { ...prev };
        delete rest[LEGACY_SELECTED_KEY];
        return rest;
      },
      { replace: true },
    );
  }, [hasLegacy]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = { ...urlState.filters };
  delete filters[LEGACY_SELECTED_KEY];

  const sorting: DataTableSort | null = urlState.sort
    ? { id: urlState.sort, desc: urlState.order === 'desc' }
    : null;

  return [
    { page: urlState.page, limit: urlState.limit, sorting, filters, selectedIds },
    {
      setPage: (page) => updateUrl({ page }),
      setLimit: (limit) => updateUrl({ limit, page: 1 }),
      setSorting: (next) => {
        if (next) {
          updateUrl({ sort: next.id, order: next.desc ? 'desc' : 'asc', page: 1 });
        } else {
          updateUrl({ sort: null, order: null, page: 1 });
        }
      },
      setFilters: (nextFilters) => {
        updateUrl({ filters: nextFilters, page: 1 });
      },
      setSelectedIds: (ids) => {
        setSelection(key, ids);
        setHeld({ key, ids });
      },
    },
  ];
}
