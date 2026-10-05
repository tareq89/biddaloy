/**
 * Shows the plain-language impact of a band change before confirming it
 * — [20.3.1] step 7. Confirming here calls `useConfirmBands`, which is
 * approval-gated (`ApprovalScope.GRADING_SCALE_MANAGE`): the very first
 * click gets a `403 APPROVAL_REQUIRED` and `useApprovedMutation`
 * (`ui/src/hooks/approval.tsx`) opens the existing step-up modal on its
 * own — this dialog never drives that modal directly, it only triggers
 * the mutation the same way any other approval-gated action does.
 *
 * Correction from the issue's own wording: the server
 * (`RecomputeService.preview`, #908) reports a single
 * `affected_result_count` — Epic 19.0 (results) hasn't landed a
 * per-outcome breakdown ("N change grade, N GPAs fall, N pass→fail")
 * yet, so this shows the one number the API actually returns rather than
 * inventing the three-way split.
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
import { useConfirmBands, type BandInput } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';

export interface RecomputePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scaleId: string;
  bands: BandInput[];
  affectedResultCount: number;
  onConfirmed: () => void;
}

export function RecomputePreviewDialog({
  open,
  onOpenChange,
  scaleId,
  bands,
  affectedResultCount,
  onConfirmed,
}: RecomputePreviewDialogProps) {
  const { t } = useTranslation('grading');
  const config = useRegionConfig();
  const confirmBands = useConfirmBands(scaleId);

  function handleConfirm() {
    confirmBands.mutate(bands, { onSuccess: onConfirmed });
  }

  // Once Confirm is clicked, nothing may dismiss this dialog until the
  // mutation settles. `$scaleId.tsx` unmounts it on close, and unmounting
  // drops the per-call `onSuccess` above (TanStack detaches the observer),
  // so a dismissal that lands while the confirm is in flight — the step-up
  // modal opening over this one and taking a pointer/focus interaction that
  // Radix's DismissableLayer attributes to *this* layer — meant the 201
  // arrived with nobody listening and the dialog reopened, stuck. Seen in
  // CI (timing-dependent), never locally. Pinning `open` during `isPending`
  // is the contract a confirm-with-write should have anyway.
  function handleOpenChange(next: boolean) {
    if (!next && confirmBands.isPending) return;
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('recomputePreview.title')}</DialogTitle>
          <DialogDescription>{t('recomputePreview.approvalHint')}</DialogDescription>
        </DialogHeader>

        {affectedResultCount > 0 ? (
          <p className="flex gap-2 rounded-md bg-status-due-bg p-3 text-status-due-fg">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('recomputePreview.impact', {
              count: affectedResultCount,
              n: formatNumber(affectedResultCount, config),
            })}
          </p>
        ) : (
          <p className="text-text-secondary">{t('recomputePreview.noImpact')}</p>
        )}

        {confirmBands.isError && (
          // Always our own sentence: `error.message` is a server string.
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {t('recomputePreview.errorMessage')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="button" loading={confirmBands.isPending} onClick={handleConfirm}>
            {confirmBands.isPending ? t('recomputePreview.saving') : t('recomputePreview.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
