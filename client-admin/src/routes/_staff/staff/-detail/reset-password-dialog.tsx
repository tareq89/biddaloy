/**
 * 12.4's admin-initiated password reset — cloned from
 * `-remove-member-dialog.tsx`'s confirm-dialog shape. `POST
 * /users/{id}/reset-password` (12.3/`useAdminResetPassword`) sends an
 * OTP/link to the target's own contact info and revokes their sessions
 * immediately, so the body names both consequences before the admin
 * confirms.
 *
 * Hidden entirely for the logged-in user's own row — an admin resets
 * *their own* password from change-password, not this action (see the
 * plan's own reasoning); `StaffDetailPage` only renders this dialog when
 * `user.id !== currentUserId`.
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
  toast,
} from '@biddaloy/ui/components';
import { useAdminResetPassword, type StaffUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StaffUser;
}

export function ResetPasswordDialog({ open, onOpenChange, user }: ResetPasswordDialogProps) {
  const { t } = useTranslation('staff');
  const resetPassword = useAdminResetPassword(user.id);

  React.useEffect(() => {
    if (open) resetPassword.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  // `RecoveryService.adminReset`'s own 400 for "no phone or email on file" —
  // distinguished by status rather than message text, since (unlike
  // `RemoveMemberDialog`'s self-removal case) there is no other 400 this
  // route can return. Also derived from the loaded `user` directly, so a
  // contactless row is caught before the admin even submits, not just after
  // the server rejects it.
  const noContact =
    (!user.phone && !user.email) ||
    (resetPassword.isError &&
      resetPassword.error instanceof ApiError &&
      resetPassword.error.statusCode === 400);

  function handleConfirm() {
    resetPassword.mutate(undefined, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t('resetDialog.success', { name: user.full_name }));
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resetDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('resetDialog.description', { name: user.full_name })}
          </DialogDescription>
        </DialogHeader>

        {(user.phone || user.email) && (
          <p className="text-sm text-muted-foreground">
            {user.phone ? t('resetDialog.viaSms') : t('resetDialog.viaEmail')}
          </p>
        )}

        {noContact && (
          <p role="alert" className="text-sm text-destructive">
            {t('resetDialog.noContact')}
          </p>
        )}
        {resetPassword.isError && !noContact && (
          <p role="alert" className="text-sm text-destructive">
            {t('resetDialog.errorMessage')}
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
            disabled={noContact}
            loading={resetPassword.isPending}
            onClick={handleConfirm}
          >
            {resetPassword.isPending ? t('resetDialog.resetting') : t('resetDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
