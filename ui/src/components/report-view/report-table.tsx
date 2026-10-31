/**
 * [8.15.26] A flat report: one row per result row, typed cells, server-side order.
 *
 * Wraps `DataTable`, so the phone gets cards for free (`layout="auto"` measures the table's own
 * width). Sorting is off because the server sorts (D4); paging, when the caller passes
 * `onPageChange`, is the server's page too.
 *
 * Also home to `ReportCell`, the one place a report cell turns into text, shared by the grouped and
 * the table-of-counts renderers. A count hidden for privacy shows "—" with a tooltip in plain
 * words, never 0 (D14, glossary rule).
 */
import * as React from 'react';

import { useLocale, useRegionConfig, useTranslation } from '../../i18n';
import { DataTable, type DataTableColumn } from '../data-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

import { DASH, columnLabel, formatCell, isHiddenCell, isNumericType } from './format-cell';
import type { ReportColumn, ReportRunResult, ReportViewMode } from './types';

/** A dash a keyboard user can reach, so the plain-words reason is not hover-only. */
export function HiddenCellMark() {
  const { t } = useTranslation('reportView');
  const text = t('hidden');
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm text-text-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {DASH}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 whitespace-normal">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface ReportCellProps {
  value: unknown;
  column: ReportColumn;
  /** The run's `suppressed` flag. */
  suppressed: boolean;
}

export function ReportCell({ value, column, suppressed }: ReportCellProps) {
  const { t } = useTranslation('reportView');
  const config = useRegionConfig();
  if (isHiddenCell(value, column, suppressed)) return <HiddenCellMark />;
  return <>{formatCell(value, column.type, config, { yes: t('yes'), no: t('no') })}</>;
}

export interface ReportTableProps {
  result: ReportRunResult;
  /** The report's title; names the table for screen readers. */
  caption?: string;
  /** Unique per table on a page; `DataTable` keys its saved state by it. */
  tableId?: string;
  /** Passing it shows the server's pager; leave it out for a single page. */
  onPageChange?: (page: number) => void;
  layout?: ReportViewMode;
  loading?: boolean;
  isFetching?: boolean;
}

interface Line {
  id: string;
  row: Record<string, unknown>;
}

const noSort = () => {};

export function ReportTable({
  result,
  caption,
  tableId = 'report-table',
  onPageChange,
  layout = 'auto',
  loading,
  isFetching,
}: ReportTableProps) {
  const { t } = useTranslation('reportView');
  const { locale } = useLocale();
  const { columns, rows, suppressed, page, page_size, total_rows } = result;

  const lines = React.useMemo<Line[]>(
    () => rows.map((row, i) => ({ id: `${page}-${i}`, row })),
    [rows, page],
  );
  const tableColumns = React.useMemo<DataTableColumn<Line>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        header: columnLabel(column, locale),
        accessorFn: (line) => (
          <ReportCell value={line.row[column.key]} column={column} suppressed={suppressed} />
        ),
        ...(isNumericType(column.type) ? { align: 'end' as const } : {}),
      })),
    [columns, locale, suppressed],
  );

  return (
    <DataTable<Line>
      tableId={tableId}
      caption={caption ?? t('table.caption')}
      columns={tableColumns}
      data={lines}
      getRowId={(line) => line.id}
      sorting={null}
      onSortingChange={noSort}
      page={page}
      pageSize={page_size}
      totalCount={total_rows}
      {...(onPageChange ? { onPageChange } : { paginated: false })}
      layout={layout}
      {...(loading !== undefined ? { loading } : {})}
      {...(isFetching !== undefined ? { isFetching } : {})}
      emptyState={{
        kind: 'no-results',
        title: t('empty.title'),
        explanation: t('empty.explanation'),
      }}
    />
  );
}
