/**
 * [16.3.5] The "Generated fees" log table — one row per `FeeGeneration`
 * batch. `generate.tsx` owns data-fetching (the `useFeeGenerations` query,
 * `useListShellState`) and passes the result straight through as props;
 * this file owns only the column set and the drill-down wiring.
 *
 * Wraps `ListShell` (title + filters + `DataTable`) rather than duplicating
 * its composition — same reasoning `dues.tsx` gives for using it directly.
 */
import { FeeGenerationSource } from '@biddaloy/shared';
import { type DataTableColumn, StatusBadge } from '@biddaloy/ui/components';
import type { FeeGeneration } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { ListShell, type FilterBarProps, type PageAction } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatDateRange,
  formatMonth,
  formatNumber,
  formatServerAmount,
  parseServerDate,
} from '@biddaloy/ui/utils';

export type { FeeGeneration };

export interface BatchTableProps {
  /** Page title, forwarded to `ListShell`. */
  title: string;
  subtitle?: string;
  /** The page's header actions (the "Create bills" primary). */
  actions?: PageAction[];
  /** URL-synced filter descriptor — built by `batch-filters.tsx` and owned
   * by the page (`generate.tsx`), since the filter values live in the
   * route's search params, not in this component. */
  filters: FilterBarProps;
  /** One page of batches — already paginated/filtered server-side. */
  data: FeeGeneration[];
  loading: boolean;
  isFetching?: boolean;
  /** A user-facing message — presence (not truthiness of an Error object)
   * is what triggers `DataTable`'s error state. */
  error?: string;
  emptyMessage: string;
  emptyExplanation?: string;
  emptyAction?: { label: string; onClick: () => void };
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (limit: number) => void;
  pageSizeLabel: string;
  /** Opens the bills dialog for the batch — wired to the row's "View bills" action. */
  onRowClick: (batch: FeeGeneration) => void;
}

export const SOURCE_LABEL_KEY: Record<string, string> = {
  [FeeGenerationSource.MANUAL]: 'generations.sourceManual',
  [FeeGenerationSource.SCHEDULE]: 'generations.sourceSchedule',
  [FeeGenerationSource.FINE_RULE]: 'generations.sourceFineRule',
};

const COLLECTION_STATUS_LABEL_KEY: Record<FeeGeneration['collection_status'], string> = {
  NONE: 'generations.collectionStatusNone',
  PARTIAL: 'generations.collectionStatusPartial',
  FULL: 'generations.collectionStatusFull',
};

const COLLECTION_TONE = { NONE: 'warning', PARTIAL: 'info', FULL: 'success' } as const;

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** "অক্টোবর ২০২৬" for a month round, "৭ই – ১৩ই সেপ্টেম্বর" for a week. */
export function formatBatchPeriod(
  row: Pick<FeeGeneration, 'period_type' | 'period_start'>,
  regionConfig: RegionConfig,
): string {
  return row.period_type === 'MONTH'
    ? formatMonth(row.period_start, regionConfig)
    : formatDateRange(
        row.period_start,
        addDays(parseServerDate(row.period_start), 6),
        regionConfig,
      );
}

/** The log's columns, shared with `schedules/$id.tsx`'s batch list. */
export function useBatchColumns(): DataTableColumn<FeeGeneration>[] {
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  return [
    {
      id: 'period',
      header: t('generations.columnPeriod'),
      accessorFn: (row) => (
        <span className="font-medium whitespace-nowrap">
          {formatBatchPeriod(row, regionConfig)}
        </span>
      ),
      card: 'title',
    },
    {
      id: 'fees',
      header: t('generations.columnFees'),
      accessorFn: (row) => row.structures.map((structure) => structure.name).join(', ') || '—',
      card: 'subtitle',
    },
    {
      id: 'students',
      header: t('generations.columnStudents'),
      // A headcount, not money.
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
      accessorFn: (row) => (
        <StatusBadge
          tone={COLLECTION_TONE[row.collection_status]}
          label={t(COLLECTION_STATUS_LABEL_KEY[row.collection_status])}
        />
      ),
      card: 'badge',
    },
    {
      id: 'source',
      header: t('generations.columnSource'),
      accessorFn: (row) => (
        <span className="flex flex-col">
          <span>{t(SOURCE_LABEL_KEY[row.source] ?? 'generations.sourceManual')}</span>
          <span className="text-caption text-text-secondary">
            {row.generated_by?.full_name ?? t('generations.systemGenerated')}
          </span>
        </span>
      ),
    },
    {
      id: 'generatedAt',
      header: t('generations.columnGeneratedAt'),
      accessorFn: (row) => formatDate(new Date(row.created_at), regionConfig),
    },
  ];
}

export function BatchTable({
  title,
  subtitle,
  actions,
  filters,
  data,
  loading,
  isFetching,
  error,
  emptyMessage,
  emptyExplanation,
  emptyAction,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeLabel,
  onRowClick,
}: BatchTableProps) {
  const { t } = useTranslation('fees');
  const columns = useBatchColumns();

  return (
    <ListShell
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(actions !== undefined ? { actions } : {})}
      filters={filters}
      tableId="fee-generations"
      caption={title}
      columns={columns}
      data={data}
      getRowId={(row) => row.id}
      rowActions={(row) => [
        { intent: 'view', label: t('generations.viewBills'), onClick: () => onRowClick(row) },
      ]}
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
      emptyState={{
        title: emptyMessage,
        // ponytail: `EmptyState` requires an explanation; schedules/$id.tsx (fees-4b) passes none yet.
        explanation: emptyExplanation ?? '',
        ...(emptyAction !== undefined ? { action: emptyAction } : {}),
      }}
      announceResults={(count, total) =>
        t('generations.announceResults', { visible: count, total, count: total })
      }
    />
  );
}

export { COLLECTION_STATUS_LABEL_KEY };
