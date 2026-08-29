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
 */
import type { RowData } from '@tanstack/react-table';
import type { ReactNode } from 'react';

import { DataTable, type DataTableProps } from '../components/data-table';

export interface ListShellProps<TData extends RowData> extends DataTableProps<TData> {
  title: string;
  primaryAction?: ReactNode;
  filterBar?: ReactNode;
}

export function ListShell<TData extends RowData>({
  title,
  primaryAction,
  filterBar,
  ...dataTableProps
}: ListShellProps<TData>) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {primaryAction}
      </div>
      {filterBar && <div className="flex flex-wrap items-center gap-2">{filterBar}</div>}
      <DataTable {...dataTableProps} />
    </div>
  );
}
