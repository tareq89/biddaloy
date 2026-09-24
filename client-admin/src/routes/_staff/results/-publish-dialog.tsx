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
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { usePublishResults, useReopenResults } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  resultCount: number;
}

export function PublishDialog({ open, onOpenChange, examId, resultCount }: PublishDialogProps) {
  const { t } = useTranslation('exams');
  const publishResults = usePublishResults(examId);

  function handleOpenChange(next: boolean) {
    if (!next && publishResults.isPending) return;
    if (!next) publishResults.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('publishDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('publishDialog.description', { count: resultCount })}
          </DialogDescription>
        </DialogHeader>

        {publishResults.isError && (
          <p role="alert" className="text-sm text-destructive">
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
  const reopenResults = useReopenResults(examId);

  // Once Confirm is clicked the approval modal may open over this one —
  // same "pin `open` during `isPending`" reasoning as
  // `-recompute-preview-dialog.tsx`'s own comment, so a stray dismissal
  // mid-flight can't strand the mutation's `onSuccess` unheard.
  function handleOpenChange(next: boolean) {
    if (!next && reopenResults.isPending) return;
    if (!next) reopenResults.reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reopenDialog.title')}</DialogTitle>
          <DialogDescription>{t('reopenDialog.impact', { count: resultCount })}</DialogDescription>
        </DialogHeader>

        {reopenResults.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('reopenDialog.errorMessage')}
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
            loading={reopenResults.isPending}
            onClick={() =>
              reopenResults.mutate(undefined, { onSuccess: () => onOpenChange(false) })
            }
          >
            {t('reopenDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
