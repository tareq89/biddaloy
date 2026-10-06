/**
 * [13.5.1] The whole register card: details → code → password → `onDone()`.
 * Step lives in component state (nothing here deserves its own URL). The
 * `/register` route mounts this inside `AuthLayout` and owns the redirect in
 * `onDone`; `verifyRegistration` has already adopted the session by then.
 */
import { ApiError, RateLimitedError } from '@biddaloy/ui/api';
import { SocialButtons, StepIndicator, type SignInFormError } from '@biddaloy/ui/components';
import {
  resendRegistrationCode,
  setFirstPassword,
  socialProvidersQueryOptions,
  socialStartUrl,
  startRegistration,
  verifyRegistration,
  type RegisterStartInput,
  type RegisterStartResult,
  type RegisterVerifyResult,
  type SocialProvider,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { RegisterCodeStep } from './register-code-step';
import { RegisterDetailsForm, type RegisterDetailsValues } from './register-details-form';
import { RegisterPasswordStep } from './register-password-step';

export interface RegisterFlowProps {
  /** Set by the route after the social callback; the ticket itself rides an httpOnly cookie. */
  socialTicket?: { provider: SocialProvider };
  /** Name / email from the social profile, prefilled by the route. */
  initialValues?: Partial<RegisterDetailsValues>;
  initialCountry?: string;
  onDone: () => void;
}

type Step = 'details' | 'code' | 'password';
const STEP_ORDER = ['details', 'verify', 'password'] as const;
const STEP_ID: Record<Step, (typeof STEP_ORDER)[number]> = {
  details: 'details',
  code: 'verify',
  password: 'password',
};

type Where = 'start' | 'resend' | 'verify' | 'password';

/** Never the server's own message — only translated copy. */
function errorKey(error: unknown, where: Where): string {
  // `publicPost` turns every 429 into a `RateLimitedError`, not an `ApiError`.
  if (error instanceof RateLimitedError) {
    return where === 'verify' ? 'otpLocked' : where === 'resend' ? 'resendLimit' : 'generic';
  }
  if (!(error instanceof ApiError)) return 'generic';
  const code = error.details?.code;
  if (code === 'TRIAL_ALREADY_OPEN') return 'trialAlreadyOpen';
  if (code === 'CONTACT_IN_USE') return 'contactInUse';
  if (code === 'SIGN_IN_REQUIRED') return 'signInRequired';
  if (
    code === 'REGISTRATION_UNAVAILABLE' ||
    code === 'ACCOUNT_UNAVAILABLE' ||
    error.statusCode === 503
  )
    return 'unavailable';
  if (where === 'start' && error.statusCode === 400) return 'captcha';
  if (where === 'verify') {
    if (error.statusCode === 400) return 'otpInvalid';
    if (error.statusCode === 410) return 'otpExpired';
  }
  if (where === 'resend') {
    if (error.statusCode === 410) return 'otpExpired';
  }
  return 'generic';
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-status-overdue-bg p-3 text-sm text-status-overdue-fg"
    >
      {children}
    </div>
  );
}

export function RegisterFlow({
  socialTicket,
  initialValues,
  initialCountry,
  onDone,
}: RegisterFlowProps) {
  const { t } = useTranslation('register');
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<Step>('details');
  const [details, setDetails] = React.useState<Partial<RegisterDetailsValues> | undefined>(
    initialValues,
  );
  const [started, setStarted] = React.useState<RegisterStartResult | null>(null);
  const [sentTo, setSentTo] = React.useState('');
  const [verified, setVerified] = React.useState<RegisterVerifyResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resendNonce, setResendNonce] = React.useState(0);
  const [captchaResetKey, setCaptchaResetKey] = React.useState(0);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const providers = useQuery(socialProvidersQueryOptions());

  // Move focus to the new step's heading (the password step's own <h1> is inside SetPasswordForm).
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const start = useMutation({
    mutationFn: (input: RegisterStartInput) => startRegistration(input),
    onSuccess: (result) => {
      setStarted(result);
      setError(null);
      setStep('code');
    },
    onError: (e) => {
      setError(errorKey(e, 'start'));
      setCaptchaResetKey((k) => k + 1);
    },
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendRegistrationCode(id),
    onSuccess: (result) => {
      setStarted(result);
      setResendNonce((n) => n + 1);
      setError(null);
    },
    onError: (e) => setError(errorKey(e, 'resend')),
  });

  const verify = useMutation({
    mutationFn: (otp: string) =>
      verifyRegistration(queryClient, { registration_id: started?.registration_id ?? '', otp }),
    onSuccess: (result) => {
      setVerified(result);
      setError(null);
      if (result.needs_password) setStep('password');
      else onDone();
    },
    onError: (e) => setError(errorKey(e, 'verify')),
  });

  const savePassword = useMutation({
    mutationFn: (password: string) => setFirstPassword(password),
    onSuccess: onDone,
    onError: (e) => setError(errorKey(e, 'password')),
  });

  const tr = t;
  const message = error ? tr(`errors.${error}`) : null;
  const passwordError: SignInFormError | null = message ? { message, tone: 'alert' } : null;

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator
        steps={STEP_ORDER.map((id) => ({ id, label: t(`steps.${id}`) }))}
        current={STEP_ID[step]}
        progressLabel={t('progress', {
          current: STEP_ORDER.indexOf(STEP_ID[step]) + 1,
          total: STEP_ORDER.length,
        })}
      />

      {step !== 'password' && (
        <h1 ref={headingRef} tabIndex={-1} className="text-h1 text-balance outline-none">
          {step === 'details' ? t('title') : t('otp.title')}
        </h1>
      )}
      {step !== 'password' && message && <Alert>{message}</Alert>}

      {step === 'details' && (
        <>
          {socialTicket ? (
            <p className="text-text-secondary">
              {t('social.continuingWith', { provider: t(`social.${socialTicket.provider}Name`) })}
            </p>
          ) : (
            providers.data &&
            providers.data.length > 0 && (
              <>
                <SocialButtons
                  providers={providers.data}
                  labelFor={(p) => t(`social.${p}`)}
                  hrefFor={(p) => socialStartUrl(p, 'register')}
                  disabled={start.isPending}
                />
                <p className="text-center text-sm text-text-secondary">{t('social.or')}</p>
              </>
            )
          )}
          <RegisterDetailsForm
            {...(details ? { initialValues: details } : {})}
            {...(initialCountry ? { initialCountry } : {})}
            loading={start.isPending}
            captchaResetKey={captchaResetKey}
            onCaptchaMissing={() => setError('captcha')}
            onSubmit={(values, phone, captchaToken) => {
              setDetails(values);
              setSentTo(phone);
              start.mutate({
                admin_name: values.adminName,
                school_name: values.schoolName,
                country_code: values.country,
                address: values.address,
                phone,
                email: values.email,
                terms_accepted: values.terms,
                captcha_token: captchaToken,
              });
            }}
          />
        </>
      )}

      {step === 'code' && started && (
        <RegisterCodeStep
          sentTo={started.channel === 'sms' ? sentTo : (details?.email ?? '')}
          channel={started.channel}
          resendIn={started.resend_in}
          resendNonce={resendNonce}
          loading={verify.isPending}
          resending={resend.isPending}
          invalid={error === 'otpInvalid'}
          onVerify={(otp) => verify.mutate(otp)}
          onResend={() => resend.mutate(started.registration_id)}
          onChangeNumber={() => {
            setError(null);
            setStep('details');
          }}
        />
      )}

      {step === 'password' && (
        <RegisterPasswordStep
          loading={savePassword.isPending}
          error={passwordError}
          onSubmit={(password) => savePassword.mutate(password)}
          {...(verified?.password_required === false ? { onSkip: onDone } : {})}
        />
      )}
    </div>
  );
}
