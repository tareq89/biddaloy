import { Permission } from '@biddaloy/shared';
import { getActiveTenant } from '@biddaloy/ui/api';
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
  useActiveRole,
  useHasPermission,
  usePinBackupJob,
  useRequestBackup,
  useSchoolSettings,
  useUpdateSchoolSettings,
  type WorkbookJob,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

import { RestoreWizard } from './restore-wizard';

const PAGE_SIZE = 10;

/** [14.12.2] Mirrors server `STORAGE_CAP_BYTES`
 * (`server/src/modules/workbook/schedule/retention.service.ts`) — 500 MB,
 * for the "Storage used: X of 500 MB" line. Not imported from the server
 * package (no shared runtime boundary between client and server code in
 * this repo); kept as a literal here, same as every other cross-boundary
 * constant this section already hand-mirrors (see this file's own
 * `WorkbookJob` header comment). */
const STORAGE_CAP_BYTES = 500 * 1024 * 1024;

/** `WorkbookJob` plus this render's per-row UI flags — see the comment
 * where `jobs` is built for why these have to sit on the row object
 * itself. */
type BackupRow = WorkbookJob & { expired: boolean; downloading: boolean };

/** Formats a byte count as a short human-readable size ("1.2 MB").
 * `size_bytes` is a bigint column the server hands back as a string — this
 * only ever uses it for display, never arithmetic beyond this formatting,
 * so `Number()` here is safe (backup file sizes are nowhere near
 * `Number.MAX_SAFE_INTEGER`). No shared `formatBytes` util exists yet
 * elsewhere in `ui/src/utils` — kept local rather than adding one for a
 * single caller. Returns an em dash for a job that hasn't produced a file
 * yet (`QUEUED`/`RUNNING`/`FAILED`). */
function formatFileSize(bytes: string | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const numeric = Number(bytes);
  if (numeric < 1024) return `${numeric} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = numeric / 1024;
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
  const pinMutation = usePinBackupJob();

  // [14.12.3/#617] The schedule control edits the caller's own tenant's
  // `backup.schedule` — there is no SUPER_ADMIN school picker in front of
  // this section (see the header comment on why it takes no `schoolId`).
  // For a SUPER_ADMIN that "own tenant" is the platform tenant, and this
  // page's picker hasn't chosen a school yet, so there is no sensible
  // target: pass `''` so `useSchoolSettings` stays disabled (its own
  // `enabled: Boolean(schoolId)` guard) rather than fetching — and later
  // silently editing — the platform tenant's schedule, and don't render
  // the control at all. The job list/download below is unaffected; it is
  // what the `?backup=<jobId>` deep link needs, not this setting.
  const isSuperAdmin = useActiveRole() === 'SUPER_ADMIN';
  const schoolId = isSuperAdmin ? '' : (getActiveTenant() ?? '');
  const settingsQuery = useSchoolSettings(schoolId);
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const schedule = settingsQuery.data?.backup?.schedule ?? 'OFF';

  function handleScheduleChange(nextSchedule: 'OFF' | 'WEEKLY' | 'DAILY') {
    updateSettings.mutate(
      { version: 1, backup: { schedule: nextSchedule } },
      {
        onSuccess: () => toast.success(t('scheduleSaveSuccess')),
        onError: () => toast.error(t('scheduleSaveFailed')),
      },
    );
  }

  function handleTogglePin(id: string, pinned: boolean) {
    pinMutation.mutate(
      { id, pinned },
      {
        // 410 = retention deleted the job under us; `usePinBackupJob` has
        // already invalidated the list so the row is about to disappear —
        // say that, not "try again".
        onError: (err) => toast.error(t(extractHttpStatus(err) === 410 ? 'pinGone' : 'pinFailed')),
      },
    );
  }

  // Per-row "this link already expired" flags, discovered only once a
  // download is actually attempted — `BackupJob` carries no expiry field
  // itself, only the download endpoint knows.
  const [expiredIds, setExpiredIds] = React.useState<ReadonlySet<string>>(new Set());
  const [downloadingId, setDownloadingId] = React.useState<string | undefined>(undefined);

  const deepLinkJobQuery = useBackupJob(backupJobId);
  const [deepLinkError, setDeepLinkError] = React.useState<'expired' | 'failed' | undefined>(
    undefined,
  );
  // Keyed by job id, not a boolean: `backupJobId` is a search param
  // (`_staff/settings.tsx`'s `?backup=`), so following a second
  // "your backup is ready" link updates it *without* remounting this
  // component. A boolean would stay set and silently swallow the new job.
  const deepLinkTriggered = React.useRef<string | undefined>(undefined);
  const highlightRef = React.useRef<HTMLSpanElement>(null);

  // ...and the previous link's error has to go with it. Cleared during
  // render rather than in an effect so the stale message never paints for
  // a frame against the new job.
  const lastSeenBackupJobId = React.useRef(backupJobId);
  if (lastSeenBackupJobId.current !== backupJobId) {
    lastSeenBackupJobId.current = backupJobId;
    setDeepLinkError(undefined);
  }

  const handleDownload = React.useCallback(
    async (id: string): Promise<'ok' | 'expired' | 'error'> => {
      setDownloadingId(id);
      try {
        await downloadBackup(id);
        return 'ok';
      } catch (err) {
        if (extractHttpStatus(err) === 410) {
          setExpiredIds((prev) => new Set(prev).add(id));
          return 'expired';
        }
        toast.error(t('downloadFailed'));
        return 'error';
      } finally {
        setDownloadingId(undefined);
      }
    },
    [t],
  );

  // The deep-link flow: once the linked job is known, either trigger its
  // download (once) or surface the "expired/unknown" message — never both,
  // and never more than once per job id.
  React.useEffect(() => {
    if (!backupJobId || deepLinkTriggered.current === backupJobId) return;
    if (deepLinkJobQuery.isError) {
      deepLinkTriggered.current = backupJobId;
      setDeepLinkError('expired');
      return;
    }
    if (deepLinkJobQuery.data) {
      if (deepLinkJobQuery.data.status === 'FAILED') {
        deepLinkTriggered.current = backupJobId;
        setDeepLinkError('failed');
        return;
      }
      if (deepLinkJobQuery.data.status === 'DELETED') {
        // A terminal status `useBackupJob` doesn't poll past — treat it the
        // same as the 410 a stale/expired job's download hits.
        deepLinkTriggered.current = backupJobId;
        setDeepLinkError('expired');
        return;
      }
      if (deepLinkJobQuery.data.status !== 'DONE') {
        // Still QUEUED/RUNNING — `useBackupJob` keeps polling every 2s, so
        // leave `deepLinkTriggered` unset and let this effect re-run once
        // it lands on a terminal status, instead of giving up here.
        return;
      }
      deepLinkTriggered.current = backupJobId;
      // `handleDownload`'s own return value tells us whether it hit a 410,
      // rather than peeking at `expiredIds` from inside a state updater
      // (that updater must stay a pure function of its previous value —
      // calling `setDeepLinkError` from inside one is a side effect that
      // isn't guaranteed to run exactly once).
      void handleDownload(backupJobId).then((outcome) => {
        if (outcome === 'expired') setDeepLinkError('expired');
      });
    }
  }, [backupJobId, deepLinkJobQuery.data, deepLinkJobQuery.isError, handleDownload]);

  React.useEffect(() => {
    if (backupJobId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' });
    }
  }, [backupJobId, jobsQuery.data]);

  function handleRequest() {
    if (requestMutation.isPending) return;
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
        const label =
          row.kind === 'SNAPSHOT'
            ? t('kindSnapshot')
            : row.kind === 'RESTORE'
              ? t('kindRestore')
              : t('kindExport');
        return (
          <span
            {...(row.id === backupJobId ? { ref: highlightRef } : {})}
            className={row.id === backupJobId ? '-mx-1 rounded bg-secondary px-1' : undefined}
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
      accessorFn: (row) => formatFileSize(row.size_bytes),
      align: 'end',
    },
    {
      id: 'requestedBy',
      header: t('columnRequestedBy'),
      accessorFn: (row) => row.requested_by?.full_name ?? '—',
    },
    {
      id: 'pinned',
      header: t('columnPinned'),
      // Only a DONE job has anything stored to pin/unpin — a
      // QUEUED/RUNNING/FAILED/DELETED row has no exempt-from-retention
      // state to toggle.
      accessorFn: (row) => {
        if (row.status !== 'DONE') return null;
        const isPending = pinMutation.isPending && pinMutation.variables?.id === row.id;
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={isPending}
            onClick={() => handleTogglePin(row.id, !row.pinned)}
          >
            {row.pinned ? t('unpin') : t('pin')}
          </Button>
        );
      },
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
              {t('failedReason', { reason: row.error ?? t('status.FAILED') })}
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

      {/* [14.12.3/#617] No immediate-resync mechanism (D10/D11) — the copy
          below deliberately never implies the new schedule is already
          running; the hourly reconciler (#615) is the only resync path.
          Hidden for a SUPER_ADMIN — see `isSuperAdmin` above. */}
      {!isSuperAdmin && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="backup-schedule" className="text-sm font-medium">
            {t('scheduleLabel')}
          </label>
          <select
            id="backup-schedule"
            className="h-8 w-fit rounded-md border border-input bg-card px-2.5 text-sm"
            value={schedule}
            disabled={!settingsQuery.data || updateSettings.isPending}
            onChange={(event) =>
              handleScheduleChange(event.target.value as 'OFF' | 'WEEKLY' | 'DAILY')
            }
          >
            <option value="OFF">{t('scheduleOff')}</option>
            <option value="WEEKLY">{t('scheduleWeekly')}</option>
            <option value="DAILY">{t('scheduleDaily')}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t('scheduleHint')}</p>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {t('storageUsed', {
          used: formatFileSize(jobsQuery.data?.storage_total_bytes),
          cap: formatFileSize(String(STORAGE_CAP_BYTES)),
        })}
      </p>

      {deepLinkError && (
        <p role="alert" className="text-sm text-destructive">
          {deepLinkError === 'failed' ? t('failedDescription') : t('deepLinkExpired')}
        </p>
      )}

      {jobs.length > 0 && (
        <div>
          <Button type="button" loading={requestMutation.isPending} onClick={handleRequest}>
            {t('requestExport')}
          </Button>
        </div>
      )}

      {jobs.length === 0 && !jobsQuery.isLoading && !jobsQuery.isError ? (
        // EmptyState's own action is the only "request a backup" button here —
        // showing the header button too duplicated the same label (Playwright's
        // strict-mode locator caught it as two matching elements).
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
function BackupStatusBadge({ status }: { status: WorkbookJob['status'] }) {
  const { t } = useTranslation('backup');
  const toneClass: Record<WorkbookJob['status'], string> = {
    QUEUED: 'bg-muted text-muted-foreground',
    RUNNING: 'bg-status-partial-bg text-status-partial-fg',
    DONE: 'bg-status-paid-bg text-status-paid-fg',
    FAILED: 'bg-status-overdue-bg text-status-overdue-fg',
    DELETED: 'bg-muted text-muted-foreground',
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
