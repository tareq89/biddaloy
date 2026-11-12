/**
 * #3821 Help a stuck school admin: send a reset link (code asked), invite another admin (the
 * existing add-admin dialog), or log out everyone in the school (confirm, then code, then the
 * count). A school with no active admin shows only the invite path (D26). Failures are fixed
 * sentences; nothing typed or returned by the server is echoed (Rule 23).
 */
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  useLogoutAllSchool,
  useSchoolAdmins,
  useSendAdminResetLink,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { AddAdminDialog } from '../../../routes/_platform/schools/-detail/add-admin-form';

export interface StuckAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function StuckAdminDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: StuckAdminDialogProps) {
  const { t } = useTranslation('schoolControl');
  const admins = useSchoolAdmins(schoolId);
  const sendLink = useSendAdminResetLink(schoolId);
  const logoutAll = useLogoutAllSchool(schoolId);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<'EMAIL' | 'SMS' | null>(null);
  const [linkFailed, setLinkFailed] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [loggedOut, setLoggedOut] = React.useState<number | null>(null);
  const [logoutFailed, setLogoutFailed] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      sendLink.reset();
      logoutAll.reset();
      setPicked(null);
      setSent(null);
      setLinkFailed(false);
      setConfirmOpen(false);
      setLoggedOut(null);
      setLogoutFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const active = (admins.data ?? []).filter((a) => a.membership_status === 'ACTIVE');
  const loaded = admins.isSuccess;
  const noAdmin = loaded && active.length === 0;

  async function handleSend() {
    if (!picked) return;
    setLinkFailed(false);
    setSent(null);
    try {
      const result = await sendLink.mutateAsync({ userId: picked });
      setSent(result.channel);
    } catch (error) {
      if (!(error instanceof ApprovalCancelledError)) setLinkFailed(true);
    }
  }

  async function handleLogoutAll() {
    setLogoutFailed(false);
    try {
      const result = await logoutAll.mutateAsync();
      setLoggedOut(result.usersSignedOut);
    } catch (error) {
      if (!(error instanceof ApprovalCancelledError)) setLogoutFailed(true);
    } finally {
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md" className="max-h-dvh overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('stuckAdmin.title')}</DialogTitle>
            <DialogDescription>
              {t('stuckAdmin.description', { name: schoolName })}
            </DialogDescription>
          </DialogHeader>

          {admins.isError && (
            <p role="alert" className="text-caption text-destructive">
              {t('stuckAdmin.loadError')}
            </p>
          )}

          {noAdmin && (
            <p role="status" className="text-body">
              {t('stuckAdmin.noAdmin')}
            </p>
          )}

          {active.length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="text-body font-medium">{t('stuckAdmin.pickAdmin')}</legend>
              {active.map((a) => (
                <label key={a.user_id} className="flex items-center gap-2 text-body">
                  <input
                    type="radio"
                    name="stuck-admin"
                    value={a.user_id}
                    checked={picked === a.user_id}
                    onChange={() => {
                      setPicked(a.user_id);
                      setSent(null);
                    }}
                  />
                  <span>
                    {a.name}
                    <span className="ps-2 text-caption text-muted-foreground">
                      {a.email ?? a.phone ?? ''}
                    </span>
                  </span>
                </label>
              ))}
              <div>
                <Button
                  type="button"
                  disabled={!picked}
                  loading={sendLink.isPending}
                  onClick={() => void handleSend()}
                >
                  {t('stuckAdmin.sendLink')}
                </Button>
              </div>
              {sent && (
                <p role="status" className="text-caption">
                  {t(`stuckAdmin.linkSent.${sent}`)}
                </p>
              )}
              {linkFailed && (
                <p role="alert" className="text-caption text-destructive">
                  {t('stuckAdmin.errors.link')}
                </p>
              )}
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>
              {t('stuckAdmin.invite')}
            </Button>
            {!noAdmin && (
              <Button type="button" variant="destructive" onClick={() => setConfirmOpen(true)}>
                {t('stuckAdmin.logoutAll')}
              </Button>
            )}
          </div>
          {loggedOut !== null && (
            <p role="status" className="text-caption">
              {t('stuckAdmin.logoutAllDone', { count: loggedOut })}
            </p>
          )}
          {logoutFailed && (
            <p role="alert" className="text-caption text-destructive">
              {t('stuckAdmin.errors.logoutAll')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.close', { ns: 'common' })}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('stuckAdmin.logoutAllTitle')}
        description={t('stuckAdmin.logoutAllDescription', { name: schoolName })}
        confirmLabel={t('stuckAdmin.logoutAllConfirm')}
        tone="danger"
        busy={logoutAll.isPending}
        onConfirm={() => void handleLogoutAll()}
      />
      <AddAdminDialog schoolId={schoolId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
