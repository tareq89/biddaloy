/**
 * [21.9.1] D11: publication is one-way. `RoutineStateService`'s
 * `LEGAL_TRANSITIONS` table has no entry at all for `PUBLISHED` — no code
 * path can move a routine back out of it — so this dialog states that
 * plainly before publishing, and no unpublish control exists anywhere in
 * this codebase (there is nothing to call).
 *
 * [31.4] A kit `ConfirmDialog` (default tone: publishing is not destructive,
 * it is just irreversible, so it is confirmed rather than coloured red).
 */
import { ConfirmDialog, toast } from '@biddaloy/ui/components';
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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('publishDialog.title')}
      description={`${t('publishDialog.oneWayExplanation')} ${t('publishDialog.correctionsExplanation')}`}
      confirmLabel={t('publishDialog.confirm')}
      cancelLabel={t('publishDialog.cancel')}
      tone="default"
      busy={publish.isPending}
      onConfirm={handleConfirm}
    />
  );
}
