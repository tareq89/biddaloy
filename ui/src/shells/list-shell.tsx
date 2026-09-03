/**
 * The most-used of the four page shells. Structure: title + primary
 * action, filter bar, then `DataTable` — which already owns the
 * bulk-action bar (appears on selection, announces the count) and
 * pagination (with its own polite result-count announcement) as of
 * [8.6.4]. `ListShell`'s own job is thin on purpose: the header row and
 * the filter-bar slot are the only two sections `DataTable` doesn't
 * already provide.
 *
 * Deliberately **not** wired to `useListUrlState` itself — this component
 * takes plain props (page/sorting/selection as values + callbacks), and
 * `useListShellState` (this directory) is the URL-backed implementation
 * of those callbacks. Keeping the shell itself router-agnostic is what
 * lets `list-shell.stories.tsx` render it in Storybook (no router needed
 * there) while a real page wires the URL-backed hook.
 *
 * [8.14.6] `isFetching` (dims stale rows in place instead of collapsing to
 * a loading state during a filter/page/sort refetch) needs no wiring here:
 * `ListShellProps` already extends `DataTableProps`, so the `...dataTableProps`
 * spread below forwards it straight through to `DataTable`. Pages just pass
 * `isFetching={xQuery.isFetching}` alongside their existing `loading` prop.
 */
import type { RowData } from '@tanstack/react-table';
import type { ReactNode } from 'react';

import { DataTable, type DataTableProps } from '../components/data-table';

import { FilterBar, type FilterBarProps } from './filter-bar';

export interface ListShellProps<TData extends RowData> extends DataTableProps<TData> {
  title: string;
  primaryAction?: ReactNode;
  /** @deprecated Untyped escape hatch, kept only until [8.14.10] migrates
   * the last page off it — a page hand-rolls its own markup here, with no
   * shared debounce/normalization/chip/mobile-collapse behavior. Prefer
   * `filters` (typed `FilterBarProps`) for any new page. Removing this
   * prop today would break the eight pages still using it
   * (`students`, `guardians`, `staff`, `invoices`, `classes`,
   * `fee-structures`, `audit-logs`, `fees/dues`) — [8.14.10]'s job, not
   * this one's. */
  filterBar?: ReactNode;
  /** [8.14.8]'s typed replacement for `filterBar` — a `FilterFieldDescriptor[]`
   * the page declares, rendered by `FilterBar` itself (debounce,
   * Bengali-digit normalization, active-filter chips including
   * deep-linked ones, mobile "Filters (n)" disclosure all come free). */
  filters?: FilterBarProps;
}

export function ListShell<TData extends RowData>({
  title,
  primaryAction,
  filterBar,
  filters,
  ...dataTableProps
}: ListShellProps<TData>) {
  if (process.env.NODE_ENV !== 'production' && filterBar && filters) {
    console.warn(
      '[ListShell] both `filterBar` (deprecated) and `filters` were passed — both render, ' +
        'one above the other. Pass only `filters` (the typed `FilterBar`) for a new page.',
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {primaryAction}
      </div>
      {filters && <FilterBar {...filters} />}
      {filterBar && <div className="flex flex-wrap items-center gap-2">{filterBar}</div>}
      <DataTable {...dataTableProps} />
    </div>
  );
}
