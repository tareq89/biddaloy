/**
 * [21.9.1] D11: publication is one-way. `RoutineStateService`'s
 * `LEGAL_TRANSITIONS` table has no entry at all for `PUBLISHED` — no code
 * path can move a routine back out of it — so this dialog states that
 * plainly before publishing, and no unpublish control exists anywhere in
 * this codebase (there is nothing to call).
 */
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, toast } from '@biddaloy/ui/components';
import { usePublishRoutine } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routineId: string;
}

export function PublishDialog({ open, onOpenChange, routineId }: PublishDialogProps) {
  const { t } = useTranslation('routines');
  const publish = usePublishRoutine(routineId);

  function handleConfirm() {
    publish.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('publishDialog.publishedToast'));
        onOpenChange(false);
      },
      onError: () => toast.error(t('publishDialog.errorToast')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('publishDialog.title')}</DialogTitle>
          <DialogDescription>{t('publishDialog.oneWayExplanation')}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t('publishDialog.correctionsExplanation')}</p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('publishDialog.cancel')}
          </Button>
          <Button type="button" loading={publish.isPending} onClick={handleConfirm}>
            {t('publishDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
