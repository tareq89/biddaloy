import {
  BulkUploadPreview,
  Button,
  Card,
  Checkbox,
  Input,
} from '@biddaloy/ui/components';
import {
  downloadBackup,
  downloadValidationErrorsCsv,
  useBackupJob,
  useRestoreBackup,
  useValidateBackup,
  type BackupJob,
  type PreviewResult,
  type RestoreSummary,
  type RestoreTabDiff,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/**
 * [14.11.3/#613] "Restore from a backup" — the irreversible action, made
 * impossible to do by accident and easy to do on purpose (D8). Built on
 * the same `BulkUploadPreview` (`@biddaloy/ui`) both the restore wizard
 * and student import share (D11): validate the uploaded workbook, show a
 * per-tab diff, gate Confirm behind the school's exact name typed by hand,
 * then hand the queued `BackupJob` to a progress panel that polls
 * `useBackupJob` — the same 2s poll `BackupSection`'s own deep link
 * already relies on.
 *
 * `commit` (`useRestoreBackup`) resolves as soon as the server has
 * *queued* the restore, not once it finishes — the minutes-long tab-by-tab
 * apply lives entirely in `renderDone`'s `RestoreProgressPanel`, so the
 * state machine in `use-bulk-upload-preview.ts` needs no change (see the
 * plan's GATE-1 note). `renderCommitting` only covers the brief
 * POST-in-flight window.
 */
export function RestoreWizard() {
  const { t } = useTranslation('backup');
  const validateMutation = useValidateBackup();
  const restoreMutation = useRestoreBackup();

  const { mutateAsync: validateAsync } = validateMutation;
  const { mutateAsync: restoreAsync } = restoreMutation;

  // `confirmSlot`/`renderCommitting` don't receive the preview result from
  // `BulkUploadPreview` itself (its own state is private to
  // `useBulkUploadPreview`) — so this wrapper mirrors the latest `validate`
  // result here, purely to feed the confirm-gate copy and the commit
  // payload. `BulkUploadPreview` remains the single source of truth for
  // which *screen* is showing.
  const [latestResult, setLatestResult] = React.useState<
    PreviewResult<RestoreSummary> | undefined
  >(undefined);
  const [confirmationText, setConfirmationText] = React.useState('');
  const [inviteRestoredUsers, setInviteRestoredUsers] = React.useState(false);

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).then((result) => {
        setLatestResult(result);
        setConfirmationText('');
        setInviteRestoredUsers(false);
        return result;
      }),
    [validateAsync],
  );

  const commit = React.useCallback(
    (stagingId: string) =>
      restoreAsync({
        staging_id: stagingId,
        confirmation_text: confirmationText,
        invite_restored_users: inviteRestoredUsers,
      }),
    [restoreAsync, confirmationText, inviteRestoredUsers],
  );

  function handleReset() {
    setLatestResult(undefined);
    setConfirmationText('');
    setInviteRestoredUsers(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{t('restoreSectionTitle')}</h3>
      <BulkUploadPreview<RestoreSummary, BackupJob>
        accept=".xlsx"
        validate={validate}
        commit={commit}
        canCommit={(result) => {
          const totals = sumTabDiffs(result.summary.tabs);
          return result.hard_error_count === 0 && totals.create + totals.update + totals.delete > 0;
        }}
        renderSummary={(result) => <RestoreDiffSummary result={result} />}
        confirmSlot={({ setBlocked }) => (
          <RestoreConfirmSlot
            result={latestResult}
            confirmationText={confirmationText}
            onConfirmationTextChange={setConfirmationText}
            inviteRestoredUsers={inviteRestoredUsers}
            onInviteRestoredUsersChange={setInviteRestoredUsers}
            setBlocked={setBlocked}
          />
        )}
        renderCommitting={() => <p className="text-sm">{t('restoreStarting')}</p>}
        renderDone={(job, reset) => (
          <RestoreProgressPanel
            initialJob={job}
            onReset={() => {
              handleReset();
              reset();
            }}
          />
        )}
      />
    </div>
  );
}

interface TabDiffTotals {
  create: number;
  update: number;
  delete: number;
  unchanged: number;
  errors: number;
}

/** Single pass over the per-tab diff, shared by every place that needs an
 * aggregate: `canCommit`'s "is there anything to do" gate, the confirm
 * slot's delete-count warning, and the totals row in `RestoreDiffSummary`. */
function sumTabDiffs(tabs: RestoreTabDiff[]): TabDiffTotals {
  return tabs.reduce(
    (acc, tab) => ({
      create: acc.create + tab.create,
      update: acc.update + tab.update,
      delete: acc.delete + tab.delete,
      unchanged: acc.unchanged + tab.unchanged,
      errors: acc.errors + tab.errors,
    }),
    { create: 0, update: 0, delete: 0, unchanged: 0, errors: 0 },
  );
}

function tabLabel(t: ReturnType<typeof useTranslation<'backup'>>['t'], tab: string): string {
  return t(`diffTabName.${tab}`, { defaultValue: tab });
}

/** `renderSummary` — a per-tab create/update/delete/unchanged/errors table
 * with a totals row, the warnings list, and (when the server supplied one)
 * a link to download the row-level errors as CSV. The row-level error
 * *table* itself (with its own client-side CSV export) is rendered by
 * `BulkUploadPreview` below this, from `result.errors` — this link is the
 * separate, server-rendered CSV the body's `## Screen` section calls for. */
export function RestoreDiffSummary({ result }: { result: PreviewResult<RestoreSummary> }) {
  const { t } = useTranslation('backup');
  const { summary } = result;

  const totals = sumTabDiffs(summary.tabs);

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">{t('diffTitle')}</h4>
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('diffTitle')}</caption>
          <thead>
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnTab')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnCreate')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnUpdate')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnDelete')}
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                {t('diffColumnUnchanged')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('diffColumnErrors')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.tabs.map((tab) => (
              <tr key={tab.tab} className="border-b border-border-subtle">
                <td className="py-1 pr-4">{tabLabel(t, tab.tab)}</td>
                <td className="py-1 pr-4">{tab.create}</td>
                <td className="py-1 pr-4">{tab.update}</td>
                <td className="py-1 pr-4">{tab.delete}</td>
                <td className="py-1 pr-4">{tab.unchanged}</td>
                <td className="py-1">{tab.errors}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1 pr-4">{t('diffTotalsRow')}</td>
              <td className="py-1 pr-4">{totals.create}</td>
              <td className="py-1 pr-4">{totals.update}</td>
              <td className="py-1 pr-4">{totals.delete}</td>
              <td className="py-1 pr-4">{totals.unchanged}</td>
              <td className="py-1">{totals.errors}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {summary.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">{t('warningsTitle')}</h4>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.errors_csv_path && (
        <button
          type="button"
          onClick={() => void downloadValidationErrorsCsv(summary.errors_csv_path ?? '')}
          className="text-left text-sm font-medium text-primary underline"
        >
          {t('downloadErrorsCsv')}
        </button>
      )}
    </div>
  );
}

interface RestoreConfirmSlotProps {
  result: PreviewResult<RestoreSummary> | undefined;
  confirmationText: string;
  onConfirmationTextChange: (value: string) => void;
  inviteRestoredUsers: boolean;
  onInviteRestoredUsersChange: (value: boolean) => void;
  setBlocked: (blocked: boolean) => void;
}

/** `confirmSlot` — states the consequences plainly, then gates Confirm
 * behind the school's *exact* name typed by hand (D8's confirmation
 * requirement, matched against the session's own school name on the
 * validate response — never a name read out of the uploaded workbook),
 * plus the opt-in "invite restored users" checkbox. */
export function RestoreConfirmSlot({
  result,
  confirmationText,
  onConfirmationTextChange,
  inviteRestoredUsers,
  onInviteRestoredUsersChange,
  setBlocked,
}: RestoreConfirmSlotProps) {
  const { t } = useTranslation('backup');
  const schoolName = result?.summary.school_name ?? '';

  React.useEffect(() => {
    // Deferred a macrotask, not called synchronously: `BulkUploadPreview`
    // itself has a mount effect ("new preview → a released confirm-slot
    // hold") that unconditionally calls the very same `setBlocked(false)`
    // whenever a fresh preview appears — including this component's own
    // first mount. Passive effects fire child-before-parent within one
    // commit, so a plain `useEffect` here loses that race: this slot's
    // `setBlocked(true)` would run, then the parent's reset effect would
    // immediately overwrite it back to `false` in the same flush, leaving
    // Confirm wrongly enabled before anyone has typed anything.
    // `setTimeout(0)` runs in the next macrotask, strictly after that
    // synchronous effect flush completes, so this always has the last
    // word.
    const id = window.setTimeout(() => {
      setBlocked(confirmationText.trim() !== schoolName);
    }, 0);
    return () => window.clearTimeout(id);
  }, [confirmationText, schoolName, setBlocked]);

  if (!result) return null;
  const { summary } = result;
  const deletes = sumTabDiffs(summary.tabs).delete;

  return (
    <div className="flex flex-col gap-3">
      {summary.is_empty_tenant ? (
        <p className="text-sm">{t('emptyTenantWorkbook')}</p>
      ) : (
        <>
          {deletes > 0 && (
            <p className="text-sm font-medium text-destructive">
              {t('restoreConsequenceDeletes', { count: deletes })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('restoreSnapshotFirst')}</p>
        </>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="restore-confirmation-text" className="text-sm font-medium">
          {t('confirmTypeNamePrompt', { schoolName })}
        </label>
        <Input
          id="restore-confirmation-text"
          value={confirmationText}
          placeholder={t('confirmTypeNamePlaceholder')}
          onChange={(event) => onConfirmationTextChange(event.target.value)}
        />
      </div>

      <span className="flex items-center gap-2 text-sm">
        <Checkbox
          id="restore-invite-users"
          checked={inviteRestoredUsers}
          onCheckedChange={(checked) => onInviteRestoredUsersChange(checked === true)}
        />
        <label htmlFor="restore-invite-users">{t('inviteRestoredUsers')}</label>
      </span>
      <p className="text-xs text-muted-foreground">{t('inviteRestoredUsersHint')}</p>
    </div>
  );
}

/** `renderDone` — the queued `BackupJob` handed to `commit`'s resolution,
 * then polled via `useBackupJob` (already stops polling on a terminal
 * status) until DONE or FAILED. Per D8, the pre-restore snapshot is the
 * only undo, so its download link is offered on *both* terminal panels. */
export function RestoreProgressPanel({
  initialJob,
  onReset,
}: {
  initialJob: BackupJob;
  onReset: () => void;
}) {
  const { t } = useTranslation('backup');
  const jobQuery = useBackupJob(initialJob.id);
  const job = jobQuery.data ?? initialJob;

  async function handleDownloadSnapshot() {
    if (!job.snapshot_job_id) return;
    await downloadBackup(job.snapshot_job_id);
  }

  if (job.status === 'DONE') {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium">{t('restoreDone')}</p>
        {job.row_counts &&
          Object.entries(job.row_counts).map(([tab, count]) => (
            <p key={tab} className="text-sm">
              {t('restoreDoneCounts', { tab: tabLabel(t, tab), count })}
            </p>
          ))}
        {job.snapshot_job_id && (
          <div>
            <Button type="button" variant="outline" onClick={() => void handleDownloadSnapshot()}>
              {t('downloadSnapshot')}
            </Button>
          </div>
        )}
        <div>
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('uploadAnother', { ns: 'bulkImport' })}
          </Button>
        </div>
      </Card>
    );
  }

  if (job.status === 'FAILED') {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {job.failed_tab
            ? t('restoreFailedTab', { tab: tabLabel(t, job.failed_tab) })
            : t('failed')}
        </p>
        {job.error_message && <p className="text-sm">{job.error_message}</p>}
        {job.failed_tab && (
          <p className="text-sm text-muted-foreground">
            {t('restoreFailedUndo', { tab: tabLabel(t, job.failed_tab) })}
          </p>
        )}
        {job.snapshot_job_id && (
          <div>
            <Button type="button" variant="outline" onClick={() => void handleDownloadSnapshot()}>
              {t('downloadSnapshot')}
            </Button>
          </div>
        )}
        <div>
          <Button type="button" variant="ghost" onClick={onReset}>
            {t('uploadAnother', { ns: 'bulkImport' })}
          </Button>
        </div>
      </Card>
    );
  }

  // QUEUED / RUNNING
  const progressText =
    job.tabs_total != null
      ? t('restoreProgressTab', {
          tab: job.current_tab ? tabLabel(t, job.current_tab) : '',
          done: job.tabs_done ?? 0,
          total: job.tabs_total,
        })
      : t('progressUnknown');

  return (
    <Card className="flex flex-col gap-2 p-4">
      <p aria-live="polite" className="text-sm">
        {progressText}
      </p>
    </Card>
  );
}
