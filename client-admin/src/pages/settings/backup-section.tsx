import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  downloadBackup,
  useBackupJob,
  useBackupJobs,
  useHasPermission,
  useRequestBackup,
  type BackupJob,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

import { RestoreWizard } from './restore-wizard';

const PAGE_SIZE = 10;

/** `BackupJob` plus this render's per-row UI flags — see the comment where
 * `jobs` is built for why these have to sit on the row object itself. */
type BackupRow = BackupJob & { expired: boolean; downloading: boolean };

/** Formats a byte count as a short human-readable size ("1.2 MB"). No
 * shared `formatBytes` util exists yet elsewhere in `ui/src/utils` — kept
 * local rather than adding one for a single caller. Returns an em dash for
 * a job that hasn't produced a file yet (`QUEUED`/`RUNNING`/`FAILED`). */
function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Reads an axios-shaped or fetch-shaped error's HTTP status code — same
 * defensive extraction `use-bulk-upload-preview.ts`'s `extractHttpStatus`
 * uses, kept local since that one isn't exported. */
function extractHttpStatus(err: unknown): number | undefined {
  const asRecord = err as { response?: { status?: number }; status?: number } | undefined;
  return asRecord?.response?.status ?? asRecord?.status;
}

/**
 * [14.11.2/#612] Settings' Backup & restore section: request a fresh
 * export, see the job history, download a finished one, and land here via
 * a `?backup=<jobId>` deep link (e.g. from an email notification once the
 * export completes).
 *
 * Unlike every other section `SchoolSettingsPage` mounts, this one checks
 * its own permission (`Permission.BACKUP_MANAGE`) rather than relying on
 * the page-level `SETTINGS_MANAGE` gate the route already enforces — an
 * ADMIN with plain settings access should not see a backup/restore control
 * at all, so the check has to live here rather than at the mount site.
 */
export interface BackupSectionProps {
  /** The `id` from `?backup=<jobId>` in the URL, when present. */
  backupJobId?: string;
}

export function BackupSection({ backupJobId }: BackupSectionProps) {
  const { t } = useTranslation('backup');
  const regionConfig = useRegionConfig();
  const canManage = useHasPermission(Permission.BACKUP_MANAGE);

  const [page, setPage] = React.useState(1);
  const jobsQuery = useBackupJobs({ page, limit: PAGE_SIZE });
  const requestMutation = useRequestBackup();

  // Per-row "this link already expired" flags, discovered only once a
  // download is actually attempted — `BackupJob` carries no expiry field
  // itself, only the download endpoint knows.
  const [expiredIds, setExpiredIds] = React.useState<ReadonlySet<string>>(new Set());
  const [downloadingId, setDownloadingId] = React.useState<string | undefined>(undefined);

  const deepLinkJobQuery = useBackupJob(backupJobId);
  const [deepLinkError, setDeepLinkError] = React.useState<'expired' | 'failed' | undefined>(
    undefined,
  );
  const deepLinkTriggered = React.useRef(false);
  const highlightRef = React.useRef<HTMLSpanElement>(null);

  const handleDownload = React.useCallback(
    async (id: string) => {
      setDownloadingId(id);
      try {
        await downloadBackup(id);
      } catch (err) {
        if (extractHttpStatus(err) === 410) {
          setExpiredIds((prev) => new Set(prev).add(id));
        } else {
          toast.error(t('downloadFailed'));
        }
      } finally {
        setDownloadingId(undefined);
      }
    },
    [t],
  );

  // The deep-link flow: once the linked job is known, either trigger its
  // download (once) or surface the "expired/unknown" message — never both,
  // and never more than once per mount.
  React.useEffect(() => {
    if (!backupJobId || deepLinkTriggered.current) return;
    if (deepLinkJobQuery.isError) {
      deepLinkTriggered.current = true;
      setDeepLinkError('expired');
      return;
    }
    if (deepLinkJobQuery.data) {
      if (deepLinkJobQuery.data.status === 'FAILED') {
        deepLinkTriggered.current = true;
        setDeepLinkError('failed');
        return;
      }
      if (deepLinkJobQuery.data.status !== 'DONE') {
        // Still QUEUED/RUNNING — `useBackupJob` keeps polling every 2s, so
        // leave `deepLinkTriggered` unset and let this effect re-run once
        // it lands on a terminal status, instead of giving up here.
        return;
      }
      deepLinkTriggered.current = true;
      void handleDownload(backupJobId).then(() => {
        // A 410 caught inside `handleDownload` lands in `expiredIds`, not
        // here — surface the same inline message for a deep link as for a
        // row's own "Expired" state.
        setExpiredIds((prev) => {
          if (prev.has(backupJobId)) setDeepLinkError('expired');
          return prev;
        });
      });
    }
  }, [backupJobId, deepLinkJobQuery.data, deepLinkJobQuery.isError, handleDownload]);

  React.useEffect(() => {
    if (backupJobId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' });
    }
  }, [backupJobId, jobsQuery.data]);

  function handleRequest() {
    requestMutation.mutate(undefined, {
      onSuccess: () => toast.success(t('requestSuccessToast')),
      onError: () => toast.error(t('requestExportFailed')),
    });
  }

  if (!canManage) return null;

  // `DataTable`'s underlying `@tanstack/react-table` memoizes a cell's
  // value by `(row.original, columnId)`, not by the `accessorFn` closure
  // identity — so a per-row UI flag (whether *this* download turned out to
  // be expired, whether *this* row is mid-download) has to live ON the row
  // object passed as `data`, not only in a closure captured by a column
  // def that gets rebuilt every render. Baking `expired`/`downloading`
  // into a fresh row array here is what makes the table actually notice.
  const jobs: BackupRow[] = (jobsQuery.data?.data ?? []).map((job) => ({
    ...job,
    expired: expiredIds.has(job.id),
    downloading: downloadingId === job.id,
  }));

  const columns: DataTableColumn<BackupRow>[] = [
    {
      id: 'kind',
      header: t('columnKind'),
      accessorFn: (row) => {
        const label = row.type === 'RESTORE' ? t('kindSnapshot') : t('kindExport');
        return (
          <span
            {...(row.id === backupJobId ? { ref: highlightRef } : {})}
            className={row.id === backupJobId ? 'rounded bg-secondary px-1 -mx-1' : undefined}
          >
            {label}
          </span>
        );
      },
      card: 'title',
    },
    {
      id: 'status',
      header: t('columnStatus'),
      accessorFn: (row) => <BackupStatusBadge status={row.status} />,
      card: 'badge',
    },
    {
      id: 'date',
      header: t('columnCreatedAt'),
      accessorFn: (row) => formatDateTime(new Date(row.created_at), regionConfig),
    },
    {
      id: 'size',
      header: t('columnSize'),
      accessorFn: (row) => formatFileSize(row.file_size_bytes),
      align: 'end',
    },
    {
      id: 'requestedBy',
      header: t('columnRequestedBy'),
      accessorFn: (row) => row.requested_by ?? '—',
    },
    {
      id: 'actions',
      header: t('columnActions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => {
        if (row.status === 'FAILED') {
          return (
            <span className="text-sm text-destructive">
              {t('failedReason', { reason: row.error_message ?? t('status.FAILED') })}
            </span>
          );
        }
        if (row.status !== 'DONE') return null;
        if (row.expired) {
          return <span className="text-sm text-muted-foreground">{t('downloadExpired')}</span>;
        }
        return (
          <Button
            type="button"
            variant="ghost"
            loading={row.downloading}
            onClick={() => void handleDownload(row.id)}
          >
            {t('download')}
          </Button>
        );
      },
    },
  ];

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t('sectionTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('containsDescription')}</p>
        <p className="text-sm text-muted-foreground">{t('neverContainsDescription')}</p>
      </div>

      {deepLinkError && (
        <p role="alert" className="text-sm text-destructive">
          {deepLinkError === 'failed' ? t('failedDescription') : t('deepLinkExpired')}
        </p>
      )}

      <div>
        <Button type="button" loading={requestMutation.isPending} onClick={handleRequest}>
          {t('requestExport')}
        </Button>
      </div>

      {jobs.length === 0 && !jobsQuery.isLoading ? (
        <EmptyState
          title={t('emptyTenant')}
          explanation={t('emptyTenantDescription')}
          action={{ label: t('requestExport'), onClick: handleRequest }}
        />
      ) : (
        <DataTable
          tableId="backup-jobs"
          caption={t('jobsListTitle')}
          columns={columns}
          data={jobs}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => undefined}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={jobsQuery.data?.total ?? 0}
          onPageChange={setPage}
          loading={jobsQuery.isLoading}
          isFetching={jobsQuery.isFetching}
          {...(jobsQuery.isError ? { error: t('requestExportFailed') } : {})}
        />
      )}

      <RestoreWizard />
    </Card>
  );
}

/** Small local status pill — deliberately not the shared `StatusBadge`
 * (`ui/src/components/status-badge.tsx`): that component's domain union is
 * driven by `shared/src/enums` lifecycle enums, and wiring a new
 * `'backup'` domain through it plus `common.json`'s `status.*` tree is
 * more machinery than one section's four-value status needs. Every
 * status still renders as text, never colour alone, matching that
 * component's own accessibility guarantee. */
function BackupStatusBadge({ status }: { status: BackupJob['status'] }) {
  const { t } = useTranslation('backup');
  const toneClass: Record<BackupJob['status'], string> = {
    QUEUED: 'bg-muted text-muted-foreground',
    RUNNING: 'bg-status-partial-bg text-status-partial-fg',
    DONE: 'bg-status-paid-bg text-status-paid-fg',
    FAILED: 'bg-status-overdue-bg text-status-overdue-fg',
  };
  return (
    <span
      data-slot="backup-status-badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
