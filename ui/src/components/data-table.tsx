/**
 * The one table every list screen in four SPAs renders through, so its
 * accessibility and performance characteristics are the product's.
 * TanStack Table supplies row-model/column-visibility/sort-state logic;
 * this component supplies the markup — a real semantic `<table>` with
 * `<caption>`, `<th scope>` and `aria-sort`, not a div-soup grid.
 *
 * Sorting, pagination and filtering are **server-side** (`manualSorting`/
 * `manualPagination`): this component never sorts or slices `data` itself,
 * it only reports intent (`onSortingChange`/`onPageChange`) and renders
 * whatever page the caller's query already fetched.
 */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type VisibilityState,
} from '@tanstack/react-table';
import * as React from 'react';

import { Checkbox } from './checkbox';

export interface DataTableSort {
  id: string;
  desc: boolean;
}

export interface DataTableColumn<TData> {
  id: string;
  header: string;
  accessorFn: (row: TData) => React.ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<TData> {
  /** Persists column visibility/order to `localStorage` under this key —
   * unique per table instance in the app (e.g. `'students-list'`). */
  tableId: string;
  caption: string;
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;

  sorting: DataTableSort | null;
  onSortingChange: (sorting: DataTableSort | null) => void;

  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;

  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: ReadonlySet<string>) => void;
  bulkActions?: React.ReactNode;

  loading?: boolean;
  error?: string;
  emptyMessage?: string;

  /** Announced (politely) whenever the visible result count changes —
   * defaults to English; pass a Bangla template for a Bangla-locale story
   * until FormField/i18next wiring exists, same as `Combobox`. */
  announceResults?: (count: number, total: number) => string;
}

function readPersistedState(tableId: string): {
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
} {
  if (typeof window === 'undefined') return { columnVisibility: {}, columnOrder: [] };
  try {
    const raw = window.localStorage.getItem(`data-table:${tableId}`);
    if (!raw) return { columnVisibility: {}, columnOrder: [] };
    const parsed = JSON.parse(raw) as {
      columnVisibility?: VisibilityState;
      columnOrder?: ColumnOrderState;
    };
    return {
      columnVisibility: parsed.columnVisibility ?? {},
      columnOrder: parsed.columnOrder ?? [],
    };
  } catch {
    // Corrupt or foreign localStorage value — fall back to defaults rather
    // than crashing the table over a display preference.
    return { columnVisibility: {}, columnOrder: [] };
  }
}

export function DataTable<TData>({
  tableId,
  caption,
  columns,
  data,
  getRowId,
  sorting,
  onSortingChange,
  page,
  pageSize,
  totalCount,
  onPageChange,
  selectedIds,
  onSelectedIdsChange,
  bulkActions,
  loading = false,
  error,
  emptyMessage = 'No results',
  announceResults = (count, total) => `${count} of ${total} result${total === 1 ? '' : 's'}`,
}: DataTableProps<TData>) {
  const [{ columnVisibility, columnOrder }, setPersisted] = React.useState(() =>
    readPersistedState(tableId),
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `data-table:${tableId}`,
      JSON.stringify({ columnVisibility, columnOrder }),
    );
  }, [tableId, columnVisibility, columnOrder]);

  const selectable = selectedIds !== undefined && onSelectedIdsChange !== undefined;

  const tanstackColumns = React.useMemo<ColumnDef<TData>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        accessorFn: column.accessorFn,
        enableSorting: column.sortable ?? false,
      })),
    [columns],
  );

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    state: {
      columnVisibility,
      columnOrder,
      sorting: sorting ? [{ id: sorting.id, desc: sorting.desc }] : [],
    },
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    onColumnVisibilityChange: (updater) => {
      setPersisted((prev) => ({
        ...prev,
        columnVisibility: typeof updater === 'function' ? updater(prev.columnVisibility) : updater,
      }));
    },
    onColumnOrderChange: (updater) => {
      setPersisted((prev) => ({
        ...prev,
        columnOrder: typeof updater === 'function' ? updater(prev.columnOrder) : updater,
      }));
    },
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater(sorting ? [{ id: sorting.id, desc: sorting.desc }] : [])
          : updater;
      const first = next[0];
      onSortingChange(first ? { id: first.id, desc: first.desc } : null);
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });

  const rows = table.getRowModel().rows;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [focusedCell, setFocusedCell] = React.useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  // Two counts, deliberately kept separate: `colSpanCount` is every column
  // in the row, including the checkbox column, for `colSpan` on a
  // loading/empty/error placeholder row. `dataColCount` excludes it — the
  // checkbox is a real `<button role="checkbox">` with its own native tab
  // stop, not part of the roving-tabindex grid, so it isn't a valid
  // `focusedCell.col` target.
  const dataColCount = table.getVisibleFlatColumns().length;
  const colSpanCount = dataColCount + (selectable ? 1 : 0);
  const regionRef = React.useRef<HTMLDivElement>(null);

  // Roving tabindex only moves the *tab stop* by re-rendering with a new
  // `tabIndex`/`data-focused` — a DOM element doesn't lose actual focus
  // just because its own `tabindex` changed to -1, so without this, arrow
  // keys would update which cell is *next* reachable via Tab while
  // `document.activeElement` stays on the cell the user started on. Only
  // steals focus when it's already somewhere inside this table, so
  // changing `focusedCell` via a prop/reset doesn't yank focus from
  // elsewhere on the page.
  React.useEffect(() => {
    if (!regionRef.current?.contains(document.activeElement)) return;
    regionRef.current.querySelector<HTMLElement>('[data-focused="true"]')?.focus();
  }, [focusedCell]);

  function moveFocus(rowDelta: number, colDelta: number) {
    setFocusedCell((prev) => {
      const row = Math.min(Math.max(prev.row + rowDelta, 0), Math.max(rows.length - 1, 0));
      const col = Math.min(Math.max(prev.col + colDelta, 0), Math.max(dataColCount - 1, 0));
      return { row, col };
    });
  }

  function toggleRow(id: string) {
    if (!selectable) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange?.(next);
  }

  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => selectedIds?.has(row.id));

  return (
    <div>
      {selectable && selectedIds && selectedIds.size > 0 && bulkActions && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-muted p-2">
          <span className="text-sm">{selectedIds.size} selected</span>
          {bulkActions}
        </div>
      )}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
          WCAG SCR29: a focusable, labelled scroll container is the
          documented technique for making an overflow region reachable and
          operable by keyboard (arrow/Home/End scroll it) when its content
          is wider than the viewport — this is what keeps the 320px
          responsive strategy from needing page-level horizontal scroll
          instead. `role="region"` + `aria-label` is exactly what the
          technique asks for, not a misuse of `tabIndex`. Re-enabled right
          after this element so the exemption doesn't leak to anything
          else in the file. */}
      <div
        ref={regionRef}
        role="region"
        tabIndex={0}
        aria-label={caption}
        className="w-full overflow-x-auto rounded-lg border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {selectable && (
                  <th scope="col" className="p-2 text-left">
                    <Checkbox
                      aria-label="Select all rows"
                      checked={rows.length > 0 && allSelected}
                      onCheckedChange={(checked) => {
                        if (checked) onSelectedIdsChange?.(new Set(rows.map((row) => row.id)));
                        else onSelectedIdsChange?.(new Set());
                      }}
                    />
                  </th>
                )}
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();
                  const ariaSort = !canSort
                    ? undefined
                    : sortDirection === 'asc'
                      ? 'ascending'
                      : sortDirection === 'desc'
                        ? 'descending'
                        : 'none';
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={ariaSort}
                      className="p-2 text-left font-medium"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => header.column.toggleSorting()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDirection === 'asc' && <span aria-hidden="true">▲</span>}
                          {sortDirection === 'desc' && <span aria-hidden="true">▼</span>}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colSpanCount} className="p-4 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={colSpanCount} className="p-4 text-center text-destructive">
                  <span role="alert">{error}</span>
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colSpanCount} className="p-4 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className="border-t border-border"
                  data-selected={selectedIds?.has(row.id) || undefined}
                >
                  {selectable && (
                    <td className="p-2">
                      <Checkbox
                        aria-label={`Select row ${rowIndex + 1}`}
                        checked={selectedIds?.has(row.id) ?? false}
                        onCheckedChange={() => toggleRow(row.id)}
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell, colIndex) => {
                    const isFocused = focusedCell.row === rowIndex && focusedCell.col === colIndex;
                    return (
                      <td
                        key={cell.id}
                        tabIndex={isFocused ? 0 : -1}
                        data-focused={isFocused || undefined}
                        className="p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        onFocus={() => setFocusedCell({ row: rowIndex, col: colIndex })}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowRight') {
                            event.preventDefault();
                            moveFocus(0, 1);
                          } else if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            moveFocus(0, -1);
                          } else if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            moveFocus(1, 0);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveFocus(-1, 0);
                          } else if (event.key === 'Home') {
                            event.preventDefault();
                            setFocusedCell({ row: rowIndex, col: 0 });
                          } else if (event.key === 'End') {
                            event.preventDefault();
                            setFocusedCell({ row: rowIndex, col: dataColCount - 1 });
                          } else if (event.key === ' ') {
                            event.preventDefault();
                            toggleRow(row.id);
                          }
                        }}
                      >
                        {cell.getValue() as React.ReactNode}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div aria-live="polite" className="sr-only">
        {!loading && !error && announceResults(rows.length, totalCount)}
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
