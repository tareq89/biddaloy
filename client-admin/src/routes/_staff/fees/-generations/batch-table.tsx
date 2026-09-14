/**
 * [16.3.5] The "Generated fees" log table — one row per `FeeGeneration`
 * batch. `generate.tsx` owns data-fetching (the `useFeeGenerations` query,
 * `useListShellState`) and passes the result straight through as props;
 * this file owns only the column set, the drill-down wiring, and the
 * documented `renderActions` extension point below.
 *
 * Wraps `ListShell` (title + filters + `DataTable`) rather than duplicating
 * its composition — same reasoning `dues.tsx` gives for using it directly.
 */
import { type DataTableColumn, StatusBadge } from '@biddaloy/ui/components';
import type { FeeGeneration } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, type FilterBarProps } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

export type { FeeGeneration };

/**
 * Contract other lanes of Epic 16 wave 3 code against before this file's
 * implementation exists in their own worktree:
 *
 * - **#655** (Generate fees modal) reads `FeeGeneration` (re-exported
 *   above) to know what a freshly-generated batch looks like once it
 *   lands in this table.
 * - **#656** (per-bill "Remove student" action, general kebab menu) is
 *   **not implemented by this ticket**. It is expected to pass
 *   `renderActions`, which this file renders in a dedicated, `pinned`
 *   actions column — pinned so the column survives the columns-menu and
 *   is never hidden, same as every other actions column in this app
 *   (see `dues.tsx`'s own `actions` column). Until #656 lands, no caller
 *   passes `renderActions` and the column renders nothing.
 */
export interface BatchTableProps {
  /** Page title, forwarded to `ListShell`. */
  title: string;
  /** The "Generate fees" button (and its modal) — rendered as `ListShell`'s
   * `primaryAction`, top-right of the toolbar. */
  primaryAction?: React.ReactNode;
  /** URL-synced filter descriptor — built by `batch-filters.tsx` and owned
   * by the page (`generate.tsx`), since the filter values live in the
   * route's search params, not in this component. */
  filters: FilterBarProps;
  /** One page of batches — already paginated/filtered server-side. */
  data: FeeGeneration[];
  loading: boolean;
  isFetching?: boolean;
  /** A user-facing message — presence (not truthiness of an Error object)
   * is what triggers `DataTable`'s error state, same as every other list
   * page in this app (`dues.tsx`'s own `{...(duesQuery.isError ? {...} :
   * {})}` spread). */
  error?: string;
  emptyMessage: string;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (limit: number) => void;
  pageSizeLabel: string;
  /**
   * Drill-down callback — invoked with the clicked batch. `DataTable` has
   * no built-in "row click" concept (unlike a selectable-row table), so
   * this is wired to the **period** cell, rendered as a button, matching
   * `dues.tsx`'s own pattern of putting an interactive element inside an
   * `accessorFn` cell rather than the row itself.
   */
  onRowClick: (batch: FeeGeneration) => void;
  /**
   * Documented extension point for **#656** (not implemented here) — a
   * per-batch renderer for the dedicated actions column. Left `undefined`
   * until that ticket lands, in which case the actions column renders
   * nothing rather than an empty cell with a header.
   */
  renderActions?: (batch: FeeGeneration) => React.ReactNode;
}

const PERIOD_TYPE_LABEL_KEY: Record<FeeGeneration['period_type'], string> = {
  MONTH: 'generations.periodTypeMonth',
  WEEK: 'generations.periodTypeWeek',
};

const SOURCE_LABEL_KEY: Record<FeeGeneration['source'], string> = {
  MANUAL: 'generations.sourceManual',
  SCHEDULE: 'generations.sourceSchedule',
};

const COLLECTION_STATUS_LABEL_KEY: Record<FeeGeneration['collection_status'], string> = {
  NONE: 'generations.collectionStatusNone',
  PARTIAL: 'generations.collectionStatusPartial',
  FULL: 'generations.collectionStatusFull',
};

export function BatchTable({
  title,
  primaryAction,
  filters,
  data,
  loading,
  isFetching,
  error,
  emptyMessage,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeLabel,
  onRowClick,
  renderActions,
}: BatchTableProps) {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  const columns: DataTableColumn<FeeGeneration>[] = [
    {
      id: 'period',
      header: t('generations.columnPeriod'),
      // No shared localized month-name formatter exists yet (`formatDate`'s
      // own doc comment — see `dues.tsx`'s identical note on its month
      // `Select`), so the period renders as a plain date plus its cadence
      // label ("2026-09-01 · Month") rather than the issue's illustrative
      // "Sep 2026" — flagged in the PR body as a gap against a formatter
      // that doesn't exist in `@biddaloy/ui/utils` today.
      accessorFn: (row) => (
        <button
          type="button"
          onClick={() => onRowClick(row)}
          className="text-sm font-medium text-primary underline underline-offset-2"
        >
          {formatDate(new Date(row.period_start), regionConfig)} ·{' '}
          {t(PERIOD_TYPE_LABEL_KEY[row.period_type])}
        </button>
      ),
      card: 'title',
    },
    {
      id: 'fees',
      header: t('generations.columnFees'),
      accessorFn: (row) =>
        row.structures.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.structures.map((structure) => (
              <span
                key={structure.id}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {structure.name}
              </span>
            ))}
          </div>
        ) : null,
    },
    {
      id: 'students',
      header: t('generations.columnStudents'),
      // A headcount, not money — `formatServerAmount` was rendering it
      // with a currency symbol (e.g. "৳ 40.00").
      accessorFn: (row) => formatNumber(row.student_count, regionConfig),
      align: 'end',
    },
    {
      id: 'billed',
      header: t('generations.columnBilled'),
      accessorFn: (row) => formatServerAmount(row.billed_amount, regionConfig),
      align: 'end',
    },
    {
      id: 'collected',
      header: t('generations.columnCollected'),
      accessorFn: (row) => formatServerAmount(row.collected_amount, regionConfig),
      align: 'end',
    },
    {
      id: 'status',
      header: t('generations.columnStatus'),
      accessorFn: (row) => <StatusBadge domain="feeGeneration" status={row.collection_status} />,
      card: 'badge',
    },
    {
      id: 'source',
      header: t('generations.columnSource'),
      accessorFn: (row) => t(SOURCE_LABEL_KEY[row.source]),
    },
    {
      id: 'generatedBy',
      header: t('generations.columnGeneratedBy'),
      accessorFn: (row) => row.generated_by?.full_name ?? t('generations.systemGenerated'),
    },
    {
      id: 'generatedAt',
      header: t('generations.columnGeneratedAt'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
    },
    {
      id: 'actions',
      header: t('generations.columnActions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => renderActions?.(row),
    },
  ];

  return (
    <ListShell
      title={title}
      primaryAction={primaryAction}
      filters={filters}
      tableId="fee-generations"
      caption={title}
      columns={columns}
      data={data}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => {}}
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      pageSizeLabel={pageSizeLabel}
      loading={loading}
      {...(isFetching !== undefined ? { isFetching } : {})}
      {...(error ? { error } : {})}
      emptyMessage={emptyMessage}
      announceResults={(count, total) =>
        t('generations.announceResults', { visible: count, total, count: total })
      }
    />
  );
}

export { COLLECTION_STATUS_LABEL_KEY };
