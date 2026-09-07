/**
 * #535's one row in the admins card — resend/revoke a pending invitation,
 * cloned from `staff/-detail/invitation-card.tsx`'s confirm-before-revoke
 * shape (same `Dialog` + destructive-confirm pattern). Each row owns its
 * own `useResendSchoolAdminInvitation`/`useRevokeSchoolAdminInvitation`
 * instance (keyed by `userId`) rather than the parent card holding one
 * shared mutation — a plain per-row `React.useState` for the confirm
 * dialog is enough since only one row's dialog is ever open at a time.
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
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  useResendSchoolAdminInvitation,
  useRevokeSchoolAdminInvitation,
  type SchoolAdminListItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AdminRowProps {
  schoolId: string;
  admin: SchoolAdminListItem;
}

export function AdminRow({ schoolId, admin }: AdminRowProps) {
  const { t } = useTranslation('platform');
  const [revokeOpen, setRevokeOpen] = React.useState(false);

  const resendInvitation = useResendSchoolAdminInvitation(schoolId, admin.user_id);
  const revokeInvitation = useRevokeSchoolAdminInvitation(schoolId, admin.user_id);

  const pending = admin.invitation !== null;
  const canRevoke =
    admin.invitation?.status === 'PENDING' || admin.invitation?.status === 'EXPIRED';

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{admin.name}</span>
          <span className="text-xs text-muted-foreground">{admin.email ?? admin.phone ?? ''}</span>
        </div>
        {admin.invitation && <StatusBadge domain="invitation" status={admin.invitation.status} />}
      </div>

      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={resendInvitation.isPending}
            onClick={() => resendInvitation.mutate()}
          >
            {resendInvitation.isPending
              ? t('schoolDetail.admins.resending')
              : t('schoolDetail.admins.resend')}
          </Button>
          {canRevoke && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeOpen(true)}>
              {t('schoolDetail.admins.revoke')}
            </Button>
          )}
        </div>
      )}

      {resendInvitation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('schoolDetail.admins.resendError')}
        </p>
      )}
      {revokeInvitation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('schoolDetail.admins.revokeError')}
        </p>
      )}

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('schoolDetail.admins.revokeConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('schoolDetail.admins.revokeConfirmDescription', { name: admin.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={revokeInvitation.isPending}
              onClick={() =>
                revokeInvitation.mutate(undefined, { onSuccess: () => setRevokeOpen(false) })
              }
            >
              {revokeInvitation.isPending
                ? t('schoolDetail.admins.revoking')
                : t('schoolDetail.admins.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
