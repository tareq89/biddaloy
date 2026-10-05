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
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

export interface PromotionRunCounts {
  promoted: number;
  retained: number;
  graduated: number;
}

export interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: PromotionRunCounts;
  config: RegionConfig;
  hasPlacementErrors: boolean;
  hasUnnotedOverrides: boolean;
  confirming: boolean;
  onConfirm: () => void;
}

export function CommitDialog({
  open,
  onOpenChange,
  counts,
  config,
  hasPlacementErrors,
  hasUnnotedOverrides,
  confirming,
  onConfirm,
}: CommitDialogProps) {
  const { t } = useTranslation('promotions');
  const blocked = hasPlacementErrors || hasUnnotedOverrides;

  return (
    // A pending commit must not be dismissed (Esc / X / outside / Cancel).
    <Dialog open={open} onOpenChange={(next) => !confirming && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('grid.commitConfirm.title')}</DialogTitle>
          <DialogDescription>
            {t('grid.commitConfirm.body', {
              promoted: formatNumber(counts.promoted, config),
              retained: formatNumber(counts.retained, config),
              graduated: formatNumber(counts.graduated, config),
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
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          >
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
