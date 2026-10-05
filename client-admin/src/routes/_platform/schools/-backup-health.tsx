import { DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type { PlatformSchoolBackupHealth } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';

/** Formats a byte count as a short human-readable size ("1.2 MB"). Same
 * shape as `backup-section.tsx`'s own `formatFileSize` — not shared,
 * since no common `ui/src/utils` helper exists yet (see that file's
 * comment for the fuller reasoning). */
function formatFileSize(bytes: string, config: RegionConfig): string {
  const numeric = Number(bytes);
  if (numeric < 1024) return `${formatNumber(numeric, config)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = numeric / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(value, config, { decimals: 1 })} ${units[unitIndex]}`;
}

/**
 * [14.12.3/#617] Presentational half of the platform "Backup health"
 * panel — per school: schedule, most recent attempt's outcome, most
 * recent success, and storage used. Pulled out of `index.tsx` so it can
 * be storied without a router or a live `usePlatformBackupHealth()`
 * query, same split `-schools-list-view.tsx` uses for the schools table
 * next to it.
 *
 * A school that has never attempted a backup renders `last_status`/
 * `last_success_at` as "Never" — there is no separate empty-state row for
 * this, since the table itself already has one row per school regardless
 * of backup history.
 */
const STATUS_TONE = {
  DONE: 'success',
  FAILED: 'danger',
  QUEUED: 'info',
  RUNNING: 'info',
  DELETED: 'neutral',
} as const;

export interface BackupHealthTableProps {
  rows: PlatformSchoolBackupHealth[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
}

export function BackupHealthTable({ rows, loading, isFetching, error }: BackupHealthTableProps) {
  const { t } = useTranslation('platform');
  const { t: tBackup } = useTranslation('backup');
  const config = useRegionConfig();

  const scheduleLabel: Record<PlatformSchoolBackupHealth['schedule'], string> = {
    OFF: t('backupHealth.scheduleOff'),
    WEEKLY: t('backupHealth.scheduleWeekly'),
    DAILY: t('backupHealth.scheduleDaily'),
  };

  const columns: DataTableColumn<PlatformSchoolBackupHealth>[] = [
    {
      id: 'name',
      header: t('backupHealth.columnSchool'),
      accessorFn: (row) => row.name,
      card: 'title',
    },
    {
      id: 'schedule',
      header: t('backupHealth.columnSchedule'),
      accessorFn: (row) => scheduleLabel[row.schedule],
      card: 'subtitle',
    },
    {
      id: 'lastStatus',
      header: t('backupHealth.columnLastStatus'),
      accessorFn: (row) =>
        row.last_status ? (
          <StatusBadge
            tone={STATUS_TONE[row.last_status]}
            label={tBackup(`status.${row.last_status}`)}
          />
        ) : (
          <StatusBadge tone="neutral" label={t('backupHealth.never')} />
        ),
      card: 'badge',
    },
    {
      id: 'lastSuccess',
      header: t('backupHealth.columnLastSuccess'),
      accessorFn: (row) =>
        row.last_success_at ? formatDateTime(row.last_success_at, config) : t('backupHealth.never'),
      card: 'subtitle',
    },
    {
      id: 'storage',
      header: t('backupHealth.columnStorage'),
      accessorFn: (row) => formatFileSize(row.storage_total_bytes, config),
      card: 'subtitle',
      align: 'end',
    },
  ];

  return (
    <DataTable
      tableId="platform-backup-health"
      caption={t('backupHealth.caption')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.school_id}
      sorting={null}
      onSortingChange={() => undefined}
      paginated={false}
      totalCount={rows.length}
      loading={loading}
      isFetching={isFetching}
      emptyState={{ title: t('backupHealth.emptyMessage'), explanation: '' }}
      {...(error !== undefined ? { error } : {})}
    />
  );
}
