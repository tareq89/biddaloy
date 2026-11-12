/**
 * #3821 Archive a school in three steps: what is exported, download the workbook, give a reason
 * and archive. Archive stays disabled until the export status is DONE AND the download finished.
 * `useArchiveSchool` is a `useApprovedMutation`, so the code prompt opens after Archive.
 * Failures are fixed sentences, never the server text or the typed reason (Rule 23).
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  downloadBackup,
  useArchiveExportStatus,
  useArchiveSchool,
  useStartArchiveExport,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const ITEMS = ['students', 'staff', 'fees', 'results'] as const;

export interface ArchiveSchoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function ArchiveSchoolDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: ArchiveSchoolDialogProps) {
  const { t } = useTranslation('schoolControl');
  const start = useStartArchiveExport(schoolId);
  const jobId = start.data?.jobId;
  const status = useArchiveExportStatus(schoolId, jobId);
  const archive = useArchiveSchool(schoolId);
  const [downloading, setDownloading] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);
  const [downloadFailed, setDownloadFailed] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      start.reset();
      archive.reset();
      setDownloading(false);
      setDownloaded(false);
      setDownloadFailed(false);
      setReason('');
      setFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const state = status.data?.status;
  const exportReady = state === 'DONE';
  const exportFailed = start.isError || state === 'FAILED' || state === 'DELETED';
  const preparing = start.isPending || (!!jobId && !exportReady && !exportFailed);
  const canArchive = exportReady && downloaded && reason.trim().length >= 5 && !archive.isPending;

  async function handleDownload() {
    if (!jobId) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadBackup(jobId, { tenantId: schoolId });
      setDownloaded(true);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  async function handleArchive() {
    if (!jobId) return;
    setFailed(false);
    try {
      await archive.mutateAsync({ exportJobId: jobId, reason: reason.trim() });
      onOpenChange(false);
      toast.success(t('archive.success'));
    } catch (error) {
      // A closed code prompt is the owner changing their mind, not a failure.
      if (!(error instanceof ApprovalCancelledError)) setFailed(true);
    }
  }

  const busy = archive.isPending || downloading;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" className="max-h-dvh overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('archive.title')}</DialogTitle>
          <DialogDescription>{t('archive.description', { name: schoolName })}</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="archive-step1" className="grid gap-2">
          <h3 id="archive-step1" className="text-body font-medium">
            {t('archive.step1')}
          </h3>
          <ul className="list-disc ps-5 text-body">
            {ITEMS.map((key) => (
              <li key={key}>{t(`archive.exports.${key}`)}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="archive-step2" className="grid gap-2">
          <h3 id="archive-step2" className="text-body font-medium">
            {t('archive.step2')}
          </h3>
          {!jobId && !start.isPending && (
            <div>
              <Button type="button" variant="outline" onClick={() => start.mutate()}>
                {t('archive.prepare')}
              </Button>
            </div>
          )}
          {preparing && (
            <p role="status" className="text-caption text-muted-foreground">
              {t('archive.preparing')}
            </p>
          )}
          {exportReady && (
            <div className="grid gap-2">
              <p role="status" className="text-caption">
                {downloaded ? t('archive.downloaded') : t('archive.ready')}
              </p>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  loading={downloading}
                  onClick={() => void handleDownload()}
                >
                  {downloading ? t('archive.downloading') : t('archive.download')}
                </Button>
              </div>
            </div>
          )}
          {exportFailed && (
            <p role="alert" className="text-caption text-destructive">
              {t('archive.errors.exportFailed')}
            </p>
          )}
          {downloadFailed && (
            <p role="alert" className="text-caption text-destructive">
              {t('archive.errors.downloadFailed')}
            </p>
          )}
        </section>

        <section aria-labelledby="archive-step3" className="grid gap-2">
          <h3 id="archive-step3" className="text-body font-medium">
            {t('archive.step3')}
          </h3>
          {!downloaded && (
            <p className="text-caption text-muted-foreground">{t('archive.needDownload')}</p>
          )}
          <Label htmlFor="archive-reason">{t('archive.reasonLabel')}</Label>
          <Textarea
            id="archive-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-caption text-muted-foreground">{t('archive.codeNote')}</p>
          {failed && (
            <p role="alert" className="text-caption text-destructive">
              {t('archive.errors.generic')}
            </p>
          )}
        </section>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!canArchive}
            loading={archive.isPending}
            onClick={() => void handleArchive()}
          >
            {t('archive.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
