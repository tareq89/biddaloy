/**
 * [26.7.1] Commit confirmation — `Ctrl+Enter` or the *Commit* button opens
 * it (wired by the caller route). Shows the run's counts and is disabled
 * while any row has a placement error or an override without a note; the
 * approval step-up (if the run has overrides) is handled entirely inside
 * `useCommitPromotionRun` — this dialog just calls `.mutate()`.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PromotionRunCounts {
  promoted: number;
  retained: number;
  graduated: number;
}

export interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: PromotionRunCounts;
  hasPlacementErrors: boolean;
  hasUnnotedOverrides: boolean;
  confirming: boolean;
  onConfirm: () => void;
}

export function CommitDialog({
  open,
  onOpenChange,
  counts,
  hasPlacementErrors,
  hasUnnotedOverrides,
  confirming,
  onConfirm,
}: CommitDialogProps) {
  const { t } = useTranslation('promotions');
  const blocked = hasPlacementErrors || hasUnnotedOverrides;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('grid.commitConfirm.title')}</DialogTitle>
          <DialogDescription>
            {t('grid.commitConfirm.body', {
              promoted: counts.promoted,
              retained: counts.retained,
              graduated: counts.graduated,
            })}
          </DialogDescription>
        </DialogHeader>
        {hasPlacementErrors && (
          <p role="alert" className="text-sm text-destructive">
            {t('grid.commitConfirm.blockedByErrors')}
          </p>
        )}
        {!hasPlacementErrors && hasUnnotedOverrides && (
          <p role="alert" className="text-sm text-destructive">
            {t('grid.commitConfirm.blockedByNotes')}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grid.commitConfirm.cancel')}
          </Button>
          <Button type="button" disabled={blocked} loading={confirming} onClick={onConfirm}>
            {t('grid.commitConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
