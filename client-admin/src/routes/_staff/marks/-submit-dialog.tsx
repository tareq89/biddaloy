/**
 * [19.7.1] Submit confirmation — `Ctrl+Enter` opens it (wired by the
 * caller route), shows the blank-cell count so a teacher isn't surprised
 * by what "submit" locks in.
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
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';

export interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blankCount: number;
  onConfirm: () => void;
  confirming: boolean;
  /** Translated line shown when the submit request failed. */
  error?: string | undefined;
}

export function SubmitDialog({
  open,
  onOpenChange,
  blankCount,
  onConfirm,
  confirming,
  error,
}: SubmitDialogProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={t('actions.close', { ns: 'common' })}>
        <DialogHeader>
          <DialogTitle>{t('submitDialog.title')}</DialogTitle>
          <DialogDescription>{t('submitDialog.description')}</DialogDescription>
        </DialogHeader>
        {blankCount > 0 && (
          <p className="text-text-secondary">
            {tg('marksSheet.blankCount', {
              count: blankCount,
              n: formatNumber(blankCount, config),
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('submitDialog.cancel')}
          </Button>
          <Button type="button" loading={confirming} onClick={onConfirm}>
            {t('submitDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
