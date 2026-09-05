import { ApiError, getActiveTenant, subscribeAuthState } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@biddaloy/ui/components';
import {
  useActiveTenant,
  useResetPassword,
  type AdminPasswordResetResult,
  type StaffUser,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StaffUser;
  isSelf: boolean;
}

/** Unmount the secret-owning child on close or tenant/target change. */
export function ResetPasswordDialog(props: ResetPasswordDialogProps) {
  const tenant = useActiveTenant();
  return props.open ? (
    <ResetPasswordDialogContent key={`${tenant}:${props.user.id}`} {...props} />
  ) : null;
}

function ResetPasswordDialogContent({
  open,
  onOpenChange,
  user,
  isSelf,
}: ResetPasswordDialogProps) {
  const { t, i18n } = useTranslation('staff');
  const resetPassword = useResetPassword();
  const tenant = useActiveTenant();
  const [result, setResult] = React.useState<AdminPasswordResetResult>();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<'ineligible' | 'error' | 'copyError'>();
  const [copied, setCopied] = React.useState(false);
  const live = React.useRef(true);
  const submitting = React.useRef(false);
  React.useEffect(() => {
    live.current = true;
    const unsubscribe = subscribeAuthState(() => {
      if (getActiveTenant() !== tenant) {
        live.current = false;
        setResult(undefined);
        onOpenChange(false);
      }
    });
    return () => {
      live.current = false;
      unsubscribe();
    };
  }, [tenant, onOpenChange]);

  function close(next: boolean) {
    if (!next) {
      live.current = false;
      setResult(undefined);
      setError(undefined);
    }
    onOpenChange(next);
  }

  async function confirm() {
    if (isSelf || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    try {
      const response = await resetPassword(user.id);
      if (live.current && getActiveTenant() === tenant) setResult(response);
    } catch (cause) {
      if (live.current && getActiveTenant() === tenant)
        setError(cause instanceof ApiError && cause.statusCode === 409 ? 'ineligible' : 'error');
    } finally {
      submitting.current = false;
      if (live.current) setPending(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      if (live.current) {
        setCopied(true);
        setError(undefined);
      }
    } catch {
      if (live.current) setError('copyError');
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resetPassword.title')}</DialogTitle>
          <DialogDescription>
            {t(result ? 'resetPassword.success' : 'resetPassword.description', {
              name: user.full_name,
            })}
          </DialogDescription>
        </DialogHeader>
        {isSelf && (
          <p role="alert" className="text-sm text-destructive">
            {t('resetPassword.selfBlocked')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(`resetPassword.${error}`)}
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-3">
            <label htmlFor="reset-temporary-password" className="text-sm font-medium">
              {t('resetPassword.temporaryPassword')}
            </label>
            <Input
              id="reset-temporary-password"
              value={result.temporary_password}
              readOnly
              autoComplete="off"
            />
            <p className="text-sm text-muted-foreground">
              {t('resetPassword.expires', {
                date: new Date(result.expires_at).toLocaleString(i18n.language),
              })}
            </p>
            <p className="text-sm">{t('resetPassword.handoff')}</p>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {t('resetPassword.copy')}
            </Button>
            {copied && (
              <p role="status" className="text-sm">
                {t('resetPassword.copied')}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t(result ? 'resetPassword.close' : 'actions.cancel', {
                ns: result ? 'staff' : 'common',
              })}
            </Button>
          </DialogClose>
          {!result && (
            <Button
              type="button"
              variant="destructive"
              disabled={isSelf || pending}
              loading={pending}
              onClick={() => void confirm()}
            >
              {t(pending ? 'resetPassword.resetting' : 'resetPassword.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
