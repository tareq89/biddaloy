/** Step 2: the 6-digit code, a 60 s resend countdown, and a way back to the details. */
import { Button, OtpInput } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface RegisterCodeStepProps {
  /** Where the code went — the phone or the email, by the server's `channel`. */
  sentTo: string;
  channel: 'sms' | 'email';
  /** Seconds until a resend is allowed; a new value restarts the countdown. */
  resendIn: number;
  resendNonce: number;
  onVerify: (otp: string) => void;
  onResend: () => void;
  onChangeNumber: () => void;
  loading?: boolean;
  resending?: boolean;
  invalid?: boolean;
}

export function RegisterCodeStep({
  sentTo,
  channel,
  resendIn,
  resendNonce,
  onVerify,
  onResend,
  onChangeNumber,
  loading = false,
  resending = false,
  invalid = false,
}: RegisterCodeStepProps) {
  const { t } = useTranslation('register');
  const [otp, setOtp] = React.useState('');
  const [seconds, setSeconds] = React.useState(resendIn);

  // `OtpInput` takes no `autoFocus`; the code is the only thing to do on this step.
  React.useEffect(() => document.getElementById('register-otp')?.focus(), []);

  React.useEffect(() => {
    setSeconds(resendIn);
    const timer = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn, resendNonce]);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (otp.length === 6) onVerify(otp);
      }}
    >
      <p className="text-text-secondary">
        {channel === 'sms'
          ? t('otp.sentToPhone', { phone: sentTo })
          : t('otp.sentToEmail', { email: sentTo })}
      </p>
      <OtpInput
        id="register-otp"
        aria-label={t('otp.title')}
        value={otp}
        onValueChange={setOtp}
        disabled={loading}
        invalid={invalid}
      />
      <Button type="submit" loading={loading} disabled={otp.length !== 6} className="w-full">
        {t('otp.verify')}
      </Button>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          disabled={seconds > 0 || resending || loading}
          onClick={onResend}
          className="w-full"
        >
          {seconds > 0 ? t('otp.resendIn', { seconds }) : t('otp.resend')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={loading}
          onClick={onChangeNumber}
          className="w-full"
        >
          {t('otp.changeNumber')}
        </Button>
      </div>
    </form>
  );
}
