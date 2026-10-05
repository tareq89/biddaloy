/**
 * [12.6] Staff detail's invitation-lifecycle card — rendered by
 * `ProfileTab` only when `invitation_status !== 'ACTIVATED'`. Resend and
 * revoke both reuse [12.1]'s existing `useResendInvitation`/
 * `useRevokeInvitation` hooks (`ui/src/hooks/users.ts`); this file only
 * adds the surrounding card, the confirm-before-revoke gate (cloned from
 * `-remove-member-dialog.tsx`'s shape), and the USER_UPDATE permission
 * gate on both actions.
 */
import { Permission } from '@biddaloy/shared';
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
import {
  useHasPermission,
  useResendInvitation,
  useRevokeInvitation,
  type StaffUser,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { MailWarningIcon, SendIcon, XIcon } from 'lucide-react';
import * as React from 'react';

export interface InvitationCardProps {
  user: StaffUser;
}

export function InvitationCard({ user }: InvitationCardProps) {
  const { t } = useTranslation('staff');
  const canUpdate = useHasPermission(Permission.USER_UPDATE);
  const [revokeOpen, setRevokeOpen] = React.useState(false);

  const resendInvitation = useResendInvitation(user.id);
  const revokeInvitation = useRevokeInvitation(user.id);

  if (user.invitation_status === 'ACTIVATED') return null;

  const status = user.invitation_status;
  const danger = status === 'EXPIRED' || status === 'REVOKED';

  return (
    <section
      aria-label={t('detail.profile.columnInvitation')}
      className={`flex flex-col gap-3 rounded-lg border border-border-subtle p-4 md:p-5 ${
        danger ? 'bg-status-overdue-bg' : 'bg-status-due-bg'
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <MailWarningIcon
            className={`mt-0.5 size-5 shrink-0 ${
              danger ? 'text-status-overdue-fg' : 'text-status-due-fg'
            }`}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-h3">{t(`status.invitation.${status}`, { ns: 'common' })}</h2>
            <p className="text-text-secondary">
              {t(`detail.invitation.explain.${status}`, { name: user.full_name })}
            </p>
          </div>
        </div>

        {canUpdate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              loading={resendInvitation.isPending}
              onClick={() => resendInvitation.mutate()}
            >
              <SendIcon aria-hidden="true" />
              {resendInvitation.isPending
                ? t('detail.invitation.resending')
                : t('detail.invitation.resend')}
            </Button>
            {(status === 'PENDING' || status === 'EXPIRED') && (
              <Button type="button" variant="ghost" onClick={() => setRevokeOpen(true)}>
                <XIcon aria-hidden="true" />
                {t('detail.invitation.revoke')}
              </Button>
            )}
          </div>
        )}
      </div>

      {resendInvitation.isError && (
        <p role="alert" className="text-caption text-destructive">
          {t('detail.invitation.resendError')}
        </p>
      )}
      {resendInvitation.isSuccess && (
        <p className="text-caption text-text-secondary">
          {t('detail.invitation.resendSuccess', { name: user.full_name })}
        </p>
      )}
      {revokeInvitation.isError && (
        <p role="alert" className="text-caption text-destructive">
          {t('detail.invitation.revokeError')}
        </p>
      )}
      {revokeInvitation.isSuccess && (
        <p className="text-caption text-text-secondary">
          {t('detail.invitation.revokeSuccess', { name: user.full_name })}
        </p>
      )}

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detail.invitation.revokeConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('detail.invitation.revokeConfirmDescription', { name: user.full_name })}
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
                ? t('detail.invitation.revoking')
                : t('detail.invitation.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
