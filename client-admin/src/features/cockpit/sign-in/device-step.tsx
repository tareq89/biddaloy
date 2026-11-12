import { Button, Checkbox, CodeField } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { useFocusFirst } from './use-focus-first';

export interface DeviceStepProps {
  /** `device` = a new device at sign-in; `enrol` = first set-up (same two codes). */
  mode: 'device' | 'enrol';
  onSubmit: (codes: { smsCode: string; emailCode: string; rememberDevice: boolean }) => void;
  loading?: boolean;
  error?: string | undefined;
  onStartAgain: () => void;
}

/** Step 3: the SMS code and the email code, "Remember this device" ticked by default. */
export function DeviceStep({
  mode,
  onSubmit,
  loading = false,
  error,
  onStartAgain,
}: DeviceStepProps) {
  const { t } = useTranslation('cockpit');
  const [smsCode, setSmsCode] = React.useState('');
  const [emailCode, setEmailCode] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const full = smsCode.length === 6 && emailCode.length === 6;
  useFocusFirst('cockpit-sms-code');

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (full) onSubmit({ smsCode, emailCode, rememberDevice: remember });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t(`signIn.${mode}.title`)}</h2>
      <p className="text-sm text-text-secondary">{t(`signIn.${mode}.body`)}</p>
      <CodeField
        id="cockpit-sms-code"
        label={t('signIn.device.smsLabel')}
        value={smsCode}
        onValueChange={setSmsCode}
      />
      <CodeField
        id="cockpit-email-code"
        label={t('signIn.device.emailLabel')}
        value={emailCode}
        onValueChange={setEmailCode}
        {...(error ? { error } : {})}
      />
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox
          id="cockpit-remember"
          checked={remember}
          onCheckedChange={(v) => setRemember(v === true)}
        />
        <label htmlFor="cockpit-remember" className="text-sm">
          {t('signIn.device.remember')}
        </label>
      </div>
      <Button type="submit" className="min-h-11 w-full" disabled={loading || !full}>
        {loading ? t('signIn.working') : t('signIn.signIn')}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={onStartAgain}>
        {t('signIn.startAgain')}
      </Button>
    </form>
  );
}
