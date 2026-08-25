/**
 * [8.11.8]'s remove-from-school confirmation. `DELETE /users/{id}`
 * deletes only the `user_tenants` membership row for the active school —
 * the copy names exactly that consequence: access is lost, the account
 * and its history remain. It deliberately does **not** claim any teacher
 * profile is deleted: no cascade exists, and a removed member's teacher
 * row survives (an orphan case the PR flags as a product decision).
 *
 * Self-removal is prevented twice: this dialog renders a disabled state
 * with an explanation when the target is the logged-in user, and the
 * server's own 400 (`UserService.remove`) is the trust boundary behind
 * it — a 400 that still gets through renders the same explanation.
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
import { useRemoveMember, type StaffUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StaffUser;
  /** Target is the logged-in user — action disabled, explanation shown. */
  isSelf: boolean;
  /** Where to go after a successful removal (the detail page navigates
   * back to the list; the list page just closes the dialog). */
  onRemoved?: () => void;
}

export function RemoveMemberDialog({
  open,
  onOpenChange,
  user,
  isSelf,
  onRemoved,
}: RemoveMemberDialogProps) {
  const { t } = useTranslation('staff');
  const removeMember = useRemoveMember();

  React.useEffect(() => {
    if (open) removeMember.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    removeMember.mutate(user.id, {
      onSuccess: () => {
        onOpenChange(false);
        onRemoved?.();
      },
    });
  }

  // Match the guard's message, not just the status code — an unrelated
  // 400 must show the generic error (and keep Confirm usable) rather
  // than falsely claim a self-removal attempt.
  const selfBlockedByServer =
    removeMember.isError &&
    removeMember.error instanceof ApiError &&
    removeMember.error.statusCode === 400 &&
    removeMember.error.message.includes('your own account');
  const blocked = isSelf || selfBlockedByServer;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('removeMember.title')}</DialogTitle>
          <DialogDescription>
            {t('removeMember.description', { name: user.full_name })}
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <p role="alert" className="text-sm text-destructive">
            {t('removeMember.selfBlocked')}
          </p>
        )}
        {removeMember.isError && !selfBlockedByServer && (
          <p role="alert" className="text-sm text-destructive">
            {t('removeMember.errorMessage')}
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
            variant="destructive"
            disabled={blocked}
            loading={removeMember.isPending}
            onClick={handleConfirm}
          >
            {removeMember.isPending ? t('removeMember.removing') : t('removeMember.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
