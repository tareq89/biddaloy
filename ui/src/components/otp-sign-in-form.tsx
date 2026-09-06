/**
 * 12.5's "Sign in with code" tab — a passwordless phone+OTP alternative to
 * `SignInForm`, sharing its card/brand-mark/banner grammar so the two tabs
 * on `/login` read as one surface. Two phases inside one component,
 * `phase: 'phone' | 'code'`, the same "step state in the component, not the
 * route" shape `forgot-password.tsx` (12.4) already established — there is
 * no server round trip that needs its own URL between them.
 *
 * Presentational and validation only, no network: the consumer
 * (`client-admin/src/routes/login.tsx`) owns the mutations calling
 * `ui/src/hooks/auth.ts`'s `requestOtp()`/`verifyOtp()` and the redirect on
 * success.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { toLatinDigits } from '../utils';
import { parsePhone } from '../utils/phone';

import { Button } from './button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { OtpInput } from './otp-input';
import { PhoneInput } from './phone-input';
import type { SignInFormError } from './sign-in-form';

export type OtpSignInCredentials = { phone: string; otp: string };

export interface OtpSignInFormProps {
  onRequest: (phone: string) => Promise<void>;
  onVerify: (input: OtpSignInCredentials) => void;
  loading?: boolean;
  error?: SignInFormError | null;
}

const RESEND_COOLDOWN_SECONDS = 60;

interface PhoneFormValues {
  phone: string;
}

/** Same alert-vs-status banner markup as `SignInForm`, factored out since
 * both phases of this form (and `SignInForm` itself) need it. */
function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 size-[1.125rem] shrink-0"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 size-[1.125rem] shrink-0"
    >
      <path
        d="M10 5.5v5l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ErrorBanner({ error }: { error: SignInFormError }) {
  return (
    <div
      role={error.tone === 'alert' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-md p-3 text-sm',
        error.tone === 'alert'
          ? 'bg-status-overdue-bg text-status-overdue-fg'
          : 'bg-status-due-bg text-status-due-fg',
      )}
    >
      {error.tone === 'alert' ? <AlertIcon /> : <ClockIcon />}
      <span>{error.message}</span>
    </div>
  );
}

export function OtpSignInForm({
  onRequest,
  onVerify,
  loading = false,
  error = null,
}: OtpSignInFormProps) {
  const { t } = useTranslation('auth');
  const regionConfig = useRegionConfig();
  const [phase, setPhase] = React.useState<{ kind: 'phone' } | { kind: 'code'; phone: string }>({
    kind: 'phone',
  });
  const [otp, setOtp] = React.useState('');
  const [secondsLeft, setSecondsLeft] = React.useState(RESEND_COOLDOWN_SECONDS);
  const [requesting, setRequesting] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z.object({
        phone: z
          .string()
          .trim()
          .min(1, t('otp.phoneRequired'))
          .refine((value) => parsePhone(value, regionConfig).valid, t('identifier.invalid')),
      }),
    [regionConfig, t],
  );

  const form = useForm<PhoneFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  React.useEffect(() => {
    if (phase.kind !== 'code' || secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase.kind, secondsLeft]);

  function toStorageFormat(raw: string): string {
    const parsed = parsePhone(raw, regionConfig);
    // Unreachable once the schema's own refine has passed.
    if (!parsed.valid) return '';
    return toLatinDigits(`0${parsed.value}`);
  }

  async function handlePhoneSubmit(values: PhoneFormValues): Promise<void> {
    const phone = toStorageFormat(values.phone);
    if (!phone) return;
    setRequesting(true);
    try {
      await onRequest(phone);
      setOtp('');
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
      setPhase({ kind: 'code', phone });
    } catch {
      // The parent mutation exposes this error through `error`; nothing more to do here.
    } finally {
      setRequesting(false);
    }
  }

  async function handleResend(phone: string): Promise<void> {
    setRequesting(true);
    try {
      await onRequest(phone);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } catch {
      // The parent mutation exposes this error through `error`; nothing more to do here.
    } finally {
      setRequesting(false);
    }
  }

  function handleVerifySubmit(phone: string): void {
    onVerify({ phone, otp: toLatinDigits(otp) });
  }

  const brandMark = (
    <div className="flex items-center justify-center gap-2">
      <div
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-base font-bold text-primary-foreground"
      >
        ব
      </div>
      <span className="text-lg font-semibold tracking-tight">{t('brand')}</span>
    </div>
  );

  if (phase.kind === 'code') {
    return (
      <div className="flex flex-col gap-6">
        {brandMark}
        <div className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8">
          <div className="flex flex-col gap-1 text-center">
            <h1 className="text-xl font-semibold text-balance">{t('otp.codeHeading')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('otp.codeSentTo', { phone: phase.phone })}
            </p>
          </div>

          {error && <ErrorBanner error={error} />}

          <div className="flex flex-col gap-1">
            <label htmlFor="otp-sign-in-code" className="text-sm font-medium">
              {t('otp.codeLabel')}
            </label>
            <OtpInput
              id="otp-sign-in-code"
              aria-label={t('otp.codeLabel')}
              value={otp}
              onValueChange={setOtp}
              disabled={loading}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            disabled={secondsLeft > 0 || requesting || loading}
            onClick={() => void handleResend(phase.phone)}
          >
            {secondsLeft > 0 ? t('otp.resendIn', { count: secondsLeft }) : t('otp.resend')}
          </Button>

          <Button
            type="button"
            loading={loading}
            disabled={otp.length !== 6}
            className="w-full"
            onClick={() => handleVerifySubmit(phase.phone)}
          >
            {loading ? t('otp.verifying') : t('otp.verify')}
          </Button>

          <button
            type="button"
            className="relative text-center text-sm text-primary underline after:absolute after:-inset-2 after:content-['']"
            disabled={loading}
            onClick={() => setPhase({ kind: 'phone' })}
          >
            {t('otp.changeNumber')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {brandMark}

      <Form {...form}>
        <form
          onSubmit={(event) => void form.handleSubmit(handlePhoneSubmit)(event)}
          noValidate
          className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8"
        >
          <div className="flex flex-col gap-1 text-center">
            <h1 className="text-xl font-semibold text-balance">{t('heading')}</h1>
            <p className="text-sm text-muted-foreground">{t('otp.subtext')}</p>
          </div>

          {error && <ErrorBanner error={error} />}

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="otp-sign-in-phone">{t('otp.phoneLabel')}</FormLabel>
                <FormControl>
                  <PhoneInput
                    {...field}
                    id="otp-sign-in-phone"
                    config={regionConfig}
                    onValueChange={(value) => field.onChange(value)}
                    disabled={requesting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" loading={requesting} className="w-full">
            {requesting ? t('otp.sendingCode') : t('otp.sendCode')}
          </Button>
        </form>
      </Form>
    </div>
  );
}
