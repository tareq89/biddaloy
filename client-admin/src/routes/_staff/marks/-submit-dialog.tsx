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
import { useTranslation } from '@biddaloy/ui/i18n';

export interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blankCount: number;
  onConfirm: () => void;
  confirming: boolean;
}

export function SubmitDialog({
  open,
  onOpenChange,
  blankCount,
  onConfirm,
  confirming,
}: SubmitDialogProps) {
  const { t } = useTranslation('exams');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('submitDialog.title')}</DialogTitle>
          <DialogDescription>{t('submitDialog.description')}</DialogDescription>
        </DialogHeader>
        {blankCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('submitDialog.blankCount', { count: blankCount })}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
