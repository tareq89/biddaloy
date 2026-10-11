/**
 * [19.8.1] step 3+4: publish (`PROCESSED -> PUBLISHED`, a plain write) and
 * reopen/unpublish (`PUBLISHED -> PROCESSED`, step-up approval-gated).
 *
 * Reopening reuses the existing step-up flow exactly the way
 * `-recompute-preview-dialog.tsx` (grading scales) does: `useReopenResults`
 * wraps `useApprovedMutation` (`ui/src/hooks/approval.tsx`), so the first
 * click gets a `403 APPROVAL_REQUIRED` and the shared `AdminVerificationModal`
 * opens on its own — this component never drives that modal directly.
 *
 * UX ordering (issue step 4, explicit): the impact preview — "N students'
 * results become editable again" — renders in THIS dialog, open and
 * visible, *before* the admin ever clicks Confirm and trips the approval
 * flow. The approval modal only appears after that click, layered on top
 * by `ApprovalModalHostProvider` — never the other way around.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  useExamCertificates,
  useHasPermission,
  usePublishResults,
  useReopenResults,
  useRevokePrintItem,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import { useState } from 'react';

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  resultCount: number;
}

export function PublishDialog({ open, onOpenChange, examId, resultCount }: PublishDialogProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const publishResults = usePublishResults(examId);

  function handleOpenChange(next: boolean) {
    if (!next && publishResults.isPending) return;
    if (!next) publishResults.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('publishDialog.title')}</DialogTitle>
          <DialogDescription>
            {tg('resultsPage.publishDescription', { n: formatNumber(resultCount, config) })}
          </DialogDescription>
        </DialogHeader>

        {publishResults.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('publishDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            loading={publishResults.isPending}
            onClick={() =>
              publishResults.mutate(undefined, { onSuccess: () => onOpenChange(false) })
            }
          >
            {t('publishDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ReopenPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  resultCount: number;
}

/** The reopen/unpublish flow — a separate dialog from `PublishDialog`
 * because the two are never open at once and the impact preview is
 * unique to reopen (D19: reopening invalidates every result's
 * `published_at` and unfreezes marks for recompute). */
export function ReopenPreviewDialog({
  open,
  onOpenChange,
  examId,
  resultCount,
}: ReopenPreviewDialogProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const { t: tp } = useTranslation('printHistory');
  const reopenResults = useReopenResults(examId);
  const revokeItem = useRevokePrintItem();
  const canRevoke = useHasPermission(Permission.DOCUMENT_REVOKE);

  // ACAD-12: result / merit certificates freeze the old GPA, so list the live ones here
  // (every page). Confirm waits for the list, so nothing is skipped by clicking early.
  const register = useExamCertificates(examId, { enabled: open });
  const certificates = register.data ?? [];
  // All ticked by default: track only the ones the admin un-ticks.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const toRevoke = canRevoke ? certificates.filter((r) => !unchecked.has(r.item_id)) : [];
  // Set once the reopen has succeeded but some revokes failed: a retry must not reopen again.
  const [reopened, setReopened] = useState(false);
  const [failedSerials, setFailedSerials] = useState<string[]>([]);

  async function revokeChecked() {
    const results = await Promise.allSettled(
      toRevoke.map((r) =>
        revokeItem.mutateAsync({ itemId: r.item_id, reason: tp('reopenRevokeReason') }),
      ),
    );
    const failed = toRevoke.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length === 0) {
      // Through handleOpenChange so `reopened` resets: the dialog stays mounted,
      // and the next Reopen (after a republish) must reopen again, not just revoke.
      handleOpenChange(false);
      return;
    }
    setFailedSerials(failed.map((r) => r.serial));
  }

  function handleConfirm() {
    if (reopened) {
      void revokeChecked();
      return;
    }
    reopenResults.mutate(undefined, {
      onSuccess: () => {
        setReopened(true);
        void revokeChecked();
      },
    });
  }

  // Once Confirm is clicked the approval modal may open over this one —
  // same "pin `open` during `isPending`" reasoning as
  // `-recompute-preview-dialog.tsx`'s own comment, so a stray dismissal
  // mid-flight can't strand the mutation's `onSuccess` unheard.
  function handleOpenChange(next: boolean) {
    if (!next && reopenResults.isPending) return;
    if (!next) {
      reopenResults.reset();
      setReopened(false);
      setFailedSerials([]);
      setUnchecked(new Set());
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('reopenDialog.title')}</DialogTitle>
          <DialogDescription>
            {tg('resultsPage.reopenImpact', { n: formatNumber(resultCount, config) })}
          </DialogDescription>
        </DialogHeader>

        {reopenResults.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('reopenDialog.errorMessage')}
          </p>
        )}

        {certificates.length > 0 && (
          <section aria-labelledby="reopen-certs" className="flex flex-col gap-2">
            <h3 id="reopen-certs" className="text-body font-medium">
              {tp('reopenRevokeTitle')}
            </h3>
            <p className="text-caption text-muted-foreground">
              {canRevoke ? tp('reopenRevokeHint') : tp('reopenRevokeReadOnly')}
            </p>
            <ul className="flex flex-col gap-1">
              {certificates.map((r) => (
                <li key={r.item_id}>
                  <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                    {canRevoke && (
                      <Checkbox
                        checked={!unchecked.has(r.item_id)}
                        onCheckedChange={(v) =>
                          setUnchecked((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.delete(r.item_id);
                            else next.add(r.item_id);
                            return next;
                          })
                        }
                      />
                    )}
                    <span className="flex flex-col text-caption">
                      <span className="font-medium">{r.serial}</span>
                      <span className="text-muted-foreground">
                        {r.subject_label} · {tp(`kind.${r.document_kind}`)} ·{' '}
                        {formatDate(r.issued_at, config)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {register.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {tp('reopenRegisterError')}
          </p>
        )}

        {failedSerials.length > 0 && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {tp('reopenRevokeFailed', { serials: failedSerials.join(', ') })}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            loading={reopenResults.isPending || revokeItem.isPending}
            disabled={register.isPending}
            onClick={handleConfirm}
          >
            {toRevoke.length > 0
              ? tp('reopenRevokeConfirm', { n: formatNumber(toRevoke.length, config) })
              : t('reopenDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
