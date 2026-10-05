/**
 * #535's per-admin row actions — resend / revoke a pending invitation as
 * `RowActions` icons (D19), with revoke behind a `ConfirmDialog` (D29).
 *
 * The invitation hooks are keyed by `userId` (`ui/src/hooks` stays as it is),
 * and hooks cannot be called per table row, so each action runs inside a tiny
 * component that only exists while that action is active:
 * `ResendRunner` fires once on mount; `RevokeConfirm` owns the dialog.
 */
import { ConfirmDialog, toast, type RowAction } from '@biddaloy/ui/components';
import {
  useResendSchoolAdminInvitation,
  useRevokeSchoolAdminInvitation,
  type SchoolAdminListItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

function ResendRunner({
  schoolId,
  admin,
  onDone,
}: {
  schoolId: string;
  admin: SchoolAdminListItem;
  onDone: () => void;
}) {
  const { t } = useTranslation('platform');
  const resend = useResendSchoolAdminInvitation(schoolId, admin.user_id);
  const started = React.useRef(false);

  React.useEffect(() => {
    // Strict-mode re-runs effects; one click must send one invitation.
    if (started.current) return;
    started.current = true;
    resend.mutate(undefined, {
      onSuccess: () => toast.success(t('schoolDetail.admins.resendSuccess')),
      onError: () => toast.error(t('schoolDetail.admins.resendError')),
      onSettled: onDone,
    });
  }, [resend, onDone, t]);

  return null;
}

function RevokeConfirm({
  schoolId,
  admin,
  onClose,
}: {
  schoolId: string;
  admin: SchoolAdminListItem;
  onClose: () => void;
}) {
  const { t } = useTranslation('platform');
  const revoke = useRevokeSchoolAdminInvitation(schoolId, admin.user_id);

  return (
    <ConfirmDialog
      open
      // A pending request must not be dismissed from under itself.
      onOpenChange={(open) => {
        if (!open && !revoke.isPending) onClose();
      }}
      tone="danger"
      title={t('schoolDetail.admins.revokeConfirmTitle')}
      description={t('schoolDetail.admins.revokeConfirmDescription', { name: admin.name })}
      confirmLabel={t('schoolDetail.admins.revoke')}
      busy={revoke.isPending}
      onConfirm={() =>
        revoke.mutate(undefined, {
          onSuccess: onClose,
          onError: () => toast.error(t('schoolDetail.admins.revokeError')),
        })
      }
    />
  );
}

export function useAdminRowActions(schoolId: string) {
  const { t } = useTranslation('platform');
  const [resendTarget, setResendTarget] = React.useState<SchoolAdminListItem | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<SchoolAdminListItem | null>(null);
  const clearResend = React.useCallback(() => setResendTarget(null), []);
  const clearRevoke = React.useCallback(() => setRevokeTarget(null), []);

  function actionsFor(admin: SchoolAdminListItem): RowAction[] {
    // `InvitationService.issueAndSend` rejects a user who already has a
    // password with 409, so an ACTIVATED invitation must not offer resend —
    // only the states where a fresh invite can actually be issued.
    const status = admin.invitation?.status;
    const canResend = status === 'PENDING' || status === 'EXPIRED' || status === 'REVOKED';
    const canRevoke = status === 'PENDING' || status === 'EXPIRED';
    return [
      {
        intent: 'send',
        label: t('schoolDetail.admins.resend'),
        allowed: canResend,
        onClick: () => setResendTarget(admin),
      },
      {
        intent: 'reject',
        label: t('schoolDetail.admins.revoke'),
        allowed: canRevoke,
        onClick: () => setRevokeTarget(admin),
      },
    ];
  }

  const dialog = (
    <>
      {resendTarget && (
        <ResendRunner
          key={resendTarget.user_id}
          schoolId={schoolId}
          admin={resendTarget}
          onDone={clearResend}
        />
      )}
      {revokeTarget && (
        <RevokeConfirm
          key={revokeTarget.user_id}
          schoolId={schoolId}
          admin={revokeTarget}
          onClose={clearRevoke}
        />
      )}
    </>
  );

  return { actionsFor, dialog };
}
