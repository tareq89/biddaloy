/**
 * [12.7] The commit-on-verify contact-change flow for a user's own
 * email/phone — `PATCH /users/me` no longer accepts either field (see
 * `useUpdateOwnProfile`'s own comment); this dialog is the only way to
 * change one for yourself.
 *
 * Steps:
 *   1. value + current password  →  `onRequest`
 *   2. phone: an OTP step        →  `onConfirmOtp`  →  done
 *      email: a "check your inbox" card (no further step — the link is
 *      clicked from outside this dialog entirely)
 *
 * Presentational only, same split every other form in this package
 * documents: the caller (`portal/account.tsx`) owns the mutations and
 * passes them in as `onRequest`/`onConfirmOtp`.
 */
import * as React from 'react';

import { useTranslation, type RegionConfig } from '../i18n';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';
import { OtpInput } from './otp-input';
import { PhoneInput } from './phone-input';

export type ContactChangeField = 'email' | 'phone';

export interface ContactChangeDialogProps {
  field: ContactChangeField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Region config for `PhoneInput` — ignored when `field === 'email'`. */
  config: RegionConfig;
  /** Starts the change. Resolves to which confirm step follows. */
  onRequest: (value: string, currentPassword: string) => Promise<'otp' | 'link'>;
  /** Confirms a pending phone change. Not called for the email flow. */
  onConfirmOtp?: (otp: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

type Step = 'form' | 'otp' | 'emailSent';

export function ContactChangeDialog({
  field,
  open,
  onOpenChange,
  config,
  onRequest,
  onConfirmOtp,
  loading = false,
  error = null,
}: ContactChangeDialogProps) {
  const { t } = useTranslation('portal');
  const [step, setStep] = React.useState<Step>('form');
  const [value, setValue] = React.useState('');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [otp, setOtp] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setStep('form');
    setValue('');
    setCurrentPassword('');
    setOtp('');
  }, [open]);

  async function handleRequestSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const channel = await onRequest(value, currentPassword);
      setStep(channel === 'otp' ? 'otp' : 'emailSent');
    } catch {
      // The caller maps this onto its own `error` prop (a 403 wrong
      // password, a 409 conflict, ...) and re-renders with it — nothing
      // further to do here, and re-throwing would surface as an unhandled
      // rejection with no listener.
    }
  }

  async function handleOtpSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!onConfirmOtp) return;
    try {
      await onConfirmOtp(otp);
      onOpenChange(false);
    } catch {
      // Same reasoning as handleRequestSubmit's catch above.
    }
  }

  const titleKey =
    field === 'email' ? 'account.contact.changeEmail.title' : 'account.contact.changePhone.title';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {step === 'form' && (
          <form
            onSubmit={(event) => void handleRequestSubmit(event)}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{t(titleKey)}</DialogTitle>
              <DialogDescription>{t('account.contact.description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-change-value" className="text-sm font-medium">
                {field === 'email'
                  ? t('account.contact.newEmailLabel')
                  : t('account.contact.newPhoneLabel')}
              </label>
              {field === 'email' ? (
                <Input
                  id="contact-change-value"
                  type="email"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                />
              ) : (
                <PhoneInput
                  id="contact-change-value"
                  value={value}
                  config={config}
                  onValueChange={(next) => setValue(next)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-change-password" className="text-sm font-medium">
                {t('account.contact.currentPasswordLabel')}
              </label>
              <Input
                id="contact-change-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('account.contact.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" loading={loading} disabled={!value || !currentPassword}>
                {t('account.contact.continue')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={(event) => void handleOtpSubmit(event)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('account.contact.otpStep.title')}</DialogTitle>
              <DialogDescription>
                {t('account.contact.otpStep.description', { value })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="contact-change-otp" className="text-sm font-medium">
                {t('account.contact.otpStep.label')}
              </label>
              <OtpInput
                id="contact-change-otp"
                value={otp}
                onValueChange={setOtp}
                aria-label={t('account.contact.otpStep.label')}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('account.contact.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" loading={loading} disabled={otp.length !== 6}>
                {t('account.contact.otpStep.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'emailSent' && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('account.contact.emailSent.title')}</DialogTitle>
              <DialogDescription>
                {t('account.contact.emailSent.description', { value })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">{t('account.contact.emailSent.done')}</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
