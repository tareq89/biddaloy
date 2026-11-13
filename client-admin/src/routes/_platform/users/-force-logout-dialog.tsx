import { ConfirmDialog } from '@biddaloy/ui/components';
import { useLogoutPlatformUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

/**
 * "Sign out everywhere" confirm. The authenticator code is asked by the shared approval modal
 * when the mutation first answers 403 APPROVAL_REQUIRED (`useApprovedMutation`).
 */
export interface ForceLogoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: { userId: string; fullName: string };
}

export function ForceLogoutDialog({ open, onOpenChange, person }: ForceLogoutDialogProps) {
  const { t } = useTranslation('platformUsers');
  const logout = useLogoutPlatformUser();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) logout.reset();
        onOpenChange(next);
      }}
      title={t('logoutTitle')}
      // A failure replaces the text in place; the dialog is an alertdialog, so it is announced.
      description={
        logout.isError ? t('logoutError') : t('logoutDescription', { name: person.fullName })
      }
      confirmLabel={t('logout')}
      busy={logout.isPending}
      onConfirm={() =>
        logout.mutate({ id: person.userId }, { onSuccess: () => onOpenChange(false) })
      }
    />
  );
}
