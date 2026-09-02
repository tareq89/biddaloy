/**
 * [8.14.7] `DataTable`'s card-mode renderer — a `<ul>` of `Card`s carrying
 * the same affordances a `<table>` row does (selection, expansion, row
 * actions), for the container widths where a `<table>` forces horizontal
 * scroll instead. `data-table.tsx` is the only importer: this file has no
 * entry in `components/index.ts` and is reached only through `DataTable`'s
 * own `layout` prop.
 *
 * Deliberately **not** a TanStack `Row<TData>` consumer directly — plumbing
 * TanStack's feature-parametrized `Row` type through a second file bought
 * nothing here, since every value this renderer needs (a cell's rendered
 * value, which column it belongs to) is already plain data by the time
 * `DataTable` calls `row.getVisibleCells()`. `DataTable` maps its own
 * TanStack row model into the plain `DataTableCardRow` shape below once,
 * so both render modes still walk the *same* row model — same column
 * visibility, same column order, same sort — without this file needing to
 * know TanStack exists.
 *
 * Card grammar copied from `client-admin/src/routes/portal/fees.tsx`
 * (`:395-418` headline + `dl` grid, `:549-605` row list: title + meta on
 * the start side, value + badge on the end side, one explicit ≥44px
 * action target) — the one place in the app that already renders this
 * shape by design, not table fallback.
 */
import type { RowData } from '@tanstack/react-table';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Card } from './card';
import { Checkbox } from './checkbox';
import type { DataTableCardRole, DataTableColumn } from './data-table';
import { Skeleton } from './skeleton';

export interface DataTableCardRowCell {
  id: string;
  columnId: string;
  value: React.ReactNode;
}

export interface DataTableCardRow<TData extends RowData> {
  id: string;
  original: TData;
  cells: DataTableCardRowCell[];
}

export interface DataTableCardsProps<TData extends RowData> {
  tableId: string;
  caption: string;
  rows: DataTableCardRow<TData>[];
  columns: DataTableColumn<TData>[];
  cardRoles: ReadonlyMap<string, DataTableCardRole>;
  alignMap: ReadonlyMap<string, 'start' | 'end'>;

  loading: boolean;
  showStaleRows: boolean;
  skeletonRowCount: number;
  error?: string;
  emptyMessage: string;

  selectable: boolean;
  selectedIds?: ReadonlySet<string>;
  toggleRow: (id: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  setPageSelection: (selected: boolean) => void;
  selectAllLabel: string;
  selectRowLabel: (rowIndex: number) => string;

  expandable: boolean;
  expandedRowIds: ReadonlySet<string>;
  toggleExpanded: (id: string) => void;
  renderExpandedRow?: (row: TData) => React.ReactNode;
  expandRowLabel: (row: TData) => string;
}

// Same literal `data-table.tsx`'s table-mode expand toggle passes to
// `flexRender` — the `<span class="sr-only">` column header text next to
// it. Card mode has no header row to hang that on, so the toggle button's
// own icon needs no separate sr-only echo; `expandRowLabel` already names
// the row.
const EXPAND_ICON_CLASS =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function fieldClassName(align: 'start' | 'end' | undefined): string {
  return cn('text-sm', align === 'end' && 'text-end tabular-nums');
}

function SkeletonCard({ index }: { index: number }): React.ReactElement {
  return (
    <li key={`skeleton-${index}`} aria-hidden="true" data-placeholder="skeleton">
      <Card className="flex flex-col gap-3 p-3.5">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border-subtle pt-2.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </Card>
    </li>
  );
}

export function DataTableCards<TData extends RowData>({
  tableId,
  caption,
  rows,
  columns,
  cardRoles,
  alignMap,
  loading,
  showStaleRows,
  skeletonRowCount,
  error,
  emptyMessage,
  selectable,
  selectedIds,
  toggleRow,
  allSelected,
  someSelected,
  setPageSelection,
  selectAllLabel,
  selectRowLabel,
  expandable,
  expandedRowIds,
  toggleExpanded,
  renderExpandedRow,
  expandRowLabel,
}: DataTableCardsProps<TData>): React.ReactElement {
  const columnById = React.useMemo(() => {
    const map = new Map<string, DataTableColumn<TData>>();
    for (const column of columns) map.set(column.id, column);
    return map;
  }, [columns]);

  return (
    <>
      {selectable && rows.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <Checkbox
            aria-label={selectAllLabel}
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => setPageSelection(checked === true)}
          />
          <span className="text-sm text-muted-foreground">{selectAllLabel}</span>
        </div>
      )}
      <ul
        data-slot="data-table-cards"
        aria-label={caption}
        aria-busy={loading || showStaleRows}
        data-fetching={showStaleRows ? 'true' : undefined}
        className={cn(
          'flex flex-col gap-2',
          showStaleRows &&
            'opacity-60 transition-opacity duration-(--motion-duration-base) ease-(--motion-ease-standard)',
        )}
      >
        {loading &&
          Array.from({ length: skeletonRowCount }, (_, index) => (
            <SkeletonCard key={index} index={index} />
          ))}
        {!loading && error && (
          <li>
            <Card className="p-4 text-center text-destructive">
              <span role="alert">{error}</span>
            </Card>
          </li>
        )}
        {!loading && !error && rows.length === 0 && (
          <li>
            <Card className="p-4 text-center text-muted-foreground">{emptyMessage}</Card>
          </li>
        )}
        {!loading &&
          !error &&
          rows.map((row, rowIndex) => {
            const isExpanded = expandable && expandedRowIds.has(row.id);
            const expandedPanelId = `${tableId}-expanded-${row.id}`;

            let titleCell: DataTableCardRowCell | undefined;
            let subtitleCell: DataTableCardRowCell | undefined;
            let badgeCell: DataTableCardRowCell | undefined;
            let actionsCell: DataTableCardRowCell | undefined;
            const fieldCells: DataTableCardRowCell[] = [];

            for (const cell of row.cells) {
              const role: DataTableCardRole = cardRoles.get(cell.columnId) ?? 'field';
              if (role === 'title' && !titleCell) titleCell = cell;
              else if (role === 'subtitle' && !subtitleCell) subtitleCell = cell;
              else if (role === 'badge' && !badgeCell) badgeCell = cell;
              else if (role === 'actions' && !actionsCell) actionsCell = cell;
              else if (role === 'hidden') continue;
              else fieldCells.push(cell);
            }

            return (
              <li key={row.id}>
                <Card
                  data-selected={selectedIds?.has(row.id) || undefined}
                  className="flex flex-col gap-3 p-3.5"
                >
                  <div className="flex items-start gap-2.5">
                    {selectable && (
                      <Checkbox
                        aria-label={selectRowLabel(rowIndex)}
                        checked={selectedIds?.has(row.id) ?? false}
                        onCheckedChange={() => toggleRow(row.id)}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {titleCell && (
                        <span className="block text-sm font-semibold">{titleCell.value}</span>
                      )}
                      {subtitleCell && (
                        <span className="block text-xs text-muted-foreground">
                          {subtitleCell.value}
                        </span>
                      )}
                    </div>
                    {badgeCell && <div className="shrink-0">{badgeCell.value}</div>}
                  </div>
                  {fieldCells.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border-subtle pt-2.5">
                      {fieldCells.map((cell) => {
                        const column = columnById.get(cell.columnId);
                        const align = alignMap.get(cell.columnId);
                        return (
                          <div key={cell.id}>
                            <dt className="text-[11px] text-muted-foreground uppercase">
                              {column?.header ?? cell.columnId}
                            </dt>
                            <dd className={fieldClassName(align)}>{cell.value}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                  {(expandable || actionsCell) && (
                    <div
                      className={cn(
                        'flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5',
                        // Arbitrary-variant selectors mirroring table mode's
                        // `[&_td_a]:min-h-6` recipe, but at the 44px touch
                        // target [8.14.7] asks card mode meet (WCAG 2.5.5),
                        // not table mode's 24px mouse/keyboard minimum —
                        // there is no `<table>` here for that class to reach
                        // through.
                        '[&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_a]:justify-center [&_button]:min-h-11 [&_button]:min-w-11',
                      )}
                    >
                      {expandable ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={isExpanded ? expandedPanelId : undefined}
                          aria-label={expandRowLabel(row.original)}
                          className={EXPAND_ICON_CLASS}
                          onClick={() => toggleExpanded(row.id)}
                        >
                          {isExpanded ? (
                            <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span />
                      )}
                      {actionsCell && (
                        <div className="flex items-center gap-3">{actionsCell.value}</div>
                      )}
                    </div>
                  )}
                  {isExpanded && (
                    <div id={expandedPanelId}>{renderExpandedRow?.(row.original)}</div>
                  )}
                </Card>
              </li>
            );
          })}
      </ul>
    </>
  );
}
