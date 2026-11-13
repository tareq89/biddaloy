import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { OpsQueue } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

/** Queues with failures first (most failed on top), then by name. Does not mutate `queues`. */
export function sortFailedFirst(queues: readonly OpsQueue[]): OpsQueue[] {
  return [...queues].sort(
    (a, b) => (b.failed ?? 0) - (a.failed ?? 0) || a.name.localeCompare(b.name),
  );
}

export interface QueuesTableProps {
  queues: OpsQueue[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
  /** Name of the queue whose retry is in flight, if any. */
  busyName?: string | undefined;
  onRetry: (name: string) => void;
}

/** The queues with waiting and failed counts. Retry failed shows only on a row that has failures. */
export function QueuesTable({
  queues,
  loading,
  isFetching,
  error,
  busyName,
  onRetry,
}: QueuesTableProps) {
  const { t } = useTranslation('platformOperations');
  const config = useRegionConfig();
  const rows = sortFailedFirst(queues);

  const count = (row: OpsQueue, value: number | undefined) =>
    row.available && value !== undefined ? formatNumber(value, config) : '-';

  const columns: DataTableColumn<OpsQueue>[] = [
    {
      id: 'name',
      header: t('queues.columnName'),
      accessorFn: (row) => (
        <span className="font-medium">
          {row.name}
          {!row.available && (
            <span className="ms-2 text-caption text-muted-foreground">
              {t('queues.unavailable')}
            </span>
          )}
        </span>
      ),
      card: 'title',
    },
    {
      id: 'waiting',
      header: t('queues.columnWaiting'),
      accessorFn: (row) => count(row, row.waiting),
      align: 'end',
      card: 'field',
    },
    {
      id: 'failed',
      header: t('queues.columnFailed'),
      accessorFn: (row) => count(row, row.failed),
      align: 'end',
      card: 'field',
    },
  ];

  return (
    <DataTable
      tableId="platform-ops-queues"
      caption={t('queues.tableCaption')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.name}
      sorting={null}
      onSortingChange={() => {}}
      paginated={false}
      totalCount={rows.length}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('queues.emptyTitle'),
        explanation: t('queues.emptyExplanation'),
        kind: 'no-results',
      }}
      rowActions={(row) => [
        {
          intent: 'restore',
          label: t('queues.retryFailedFor', { name: row.name }),
          shortLabel: t('queues.retryFailed'),
          display: 'text',
          allowed: row.available && (row.failed ?? 0) > 0,
          busy: busyName === row.name,
          onClick: () => onRetry(row.name),
        },
      ]}
      announceResults={(shown, total) => t('queues.announceResults', { count: shown, total })}
    />
  );
}
