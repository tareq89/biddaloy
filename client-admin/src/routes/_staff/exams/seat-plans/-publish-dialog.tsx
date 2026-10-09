/**
 * [25.7] step 5: publish a DRAFT plan. Mirrors `results/-publish-dialog.tsx`'s
 * confirm shape — a plain write, no approval gate (unlike results' reopen).
 * A failure shows one translated line, never the server text.
 */
import { ConfirmDialog } from '@biddaloy/ui/components';
import { usePublishSeatPlan } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PublishSeatPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
}

export function PublishSeatPlanDialog({ open, onOpenChange, planId }: PublishSeatPlanDialogProps) {
  const { t } = useTranslation('seatPlansDetail');
  const publish = usePublishSeatPlan(planId);

  function handleOpenChange(next: boolean) {
    if (!next && publish.isPending) return;
    if (!next) publish.reset();
    onOpenChange(next);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      tone="default"
      title={t('publish.title')}
      description={
        publish.isError
          ? `${t('publish.description')} ${t('publish.errorMessage')}`
          : t('publish.description')
      }
      confirmLabel={t('publish.confirm')}
      busy={publish.isPending}
      onConfirm={() => publish.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
    />
  );
}
