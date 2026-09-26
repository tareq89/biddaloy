/**
 * [25.7] step 5: publish a DRAFT plan. Mirrors `results/-publish-dialog.tsx`'s
 * confirm shape — a plain write, no approval gate (unlike results' reopen).
 */
import { ApiError } from '@biddaloy/ui/api';
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

  const errorMessage = publish.error instanceof ApiError ? publish.error.message : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('publish.title')}</DialogTitle>
          <DialogDescription>{t('publish.description')}</DialogDescription>
        </DialogHeader>

        {errorMessage !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
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
            loading={publish.isPending}
            onClick={() => publish.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {t('publish.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
