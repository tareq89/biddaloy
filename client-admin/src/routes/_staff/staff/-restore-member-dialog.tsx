/**
 * [13.5.9] Confirm bringing a former member back (`POST /users/{id}/restore`).
 * Not destructive, so a plain primary button.
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
  toast,
} from '@biddaloy/ui/components';
import { useRestoreMember, type StaffUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface RestoreMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StaffUser;
}

export function RestoreMemberDialog({ open, onOpenChange, user }: RestoreMemberDialogProps) {
  const { t } = useTranslation('staff');
  const restore = useRestoreMember();

  function handleConfirm() {
    restore.mutate(user.id, {
      onSuccess: () => {
        toast.success(t('former.restored', { name: user.full_name }));
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('former.bringBack')}</DialogTitle>
          <DialogDescription>
            {t('former.bringBackConfirm', { name: user.full_name })}
          </DialogDescription>
        </DialogHeader>
        {restore.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('former.errorMessage')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="button" loading={restore.isPending} onClick={handleConfirm}>
            {t('former.bringBack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
