/**
 * 12.4's self-service recovery flow: identifier → OTP-or-link → new
 * password → signed in. One route with step state in the component
 * (per the plan's "Plan corrections" #2), not three routes — there is no
 * server round trip that needs its own URL between these steps, and a
 * back-button landing mid-flow with no state to resume isn't a case worth
 * a dedicated route for.
 *
 * Enumeration-safe throughout: `postAuthForgotPassword` (12.3) always
 * resolves 202 regardless of whether the identifier matches a real
 * account, so this component never learns "no such account" and always
 * shows the same copy either way (the AC's own requirement).
 */
import {
  ApiError,
  postAuthForgotPassword,
  RateLimitedError,
  type ForgotPasswordResponse,
} from '@biddaloy/ui/api';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  OtpInput,
  RouteStatusState,
  SetPasswordForm,
  type SignInFormError,
} from '@biddaloy/ui/components';
import { resetPassword } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { detectLoginIdentifier } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthScreen } from './-auth-screen';

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
});

const RESEND_COOLDOWN_SECONDS = 60;

type Step =
  | { kind: 'identifier' }
  | { kind: 'code'; phone: string }
  | { kind: 'password'; phone: string; otp: string }
  | { kind: 'linkSent' };

/** Decorative, `aria-hidden` — matches `activate.tsx`'s `LinkIcon` convention
 * for `RouteStatusState`'s icon slot. */
function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-8">
      <rect x="3" y="5" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 5.5l6.5 5 6.5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mirrors `login.tsx`'s `buildLoginError`/`activate.tsx`'s `buildActivateError`
 * — never the raw `ApiError` message, only translated copy. A 401 here means
 * "wrong/expired code", not "wrong password" (the password itself has no
 * server-side complaint besides length, already caught by `SetPasswordForm`'s
 * own zod schema). */
function buildResetError(error: unknown, t: TFunction<'auth'>): SignInFormError | null {
  if (!error) return null;

  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? { message: t('errors.rateLimited', { count: error.retryAfterSeconds }), tone: 'status' }
      : { message: t('errors.rateLimitedGeneric'), tone: 'status' };
  }

  if (error instanceof ApiError && error.statusCode === 401) {
    return { message: t('forgot.errors.invalidCode'), tone: 'alert' };
  }

  return { message: t('errors.generic'), tone: 'alert' };
}

interface IdentifierFormValues {
  identifier: string;
}

/** Step 1: collect an email or phone, same one-field pattern as `SignInForm`
 * (`detectLoginIdentifier`) — this is the same audience hitting the same
 * login screen, so the input shape is identical. */
function IdentifierStep({
  onResult,
}: {
  onResult: (
    identifier: ReturnType<typeof detectLoginIdentifier>,
    response: ForgotPasswordResponse,
  ) => void;
}) {
  const { t } = useTranslation('auth');
  const regionConfig = useRegionConfig();
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const schema = React.useMemo(
    () =>
      z.object({
        identifier: z
          .string()
          .trim()
          .min(1, t('identifier.required'))
          .refine(
            (value) => detectLoginIdentifier(value, regionConfig).kind !== 'invalid',
            t('identifier.invalid'),
          ),
      }),
    [regionConfig, t],
  );

  const form = useForm<IdentifierFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  const mutation = useMutation({
    mutationFn: (value: string) => postAuthForgotPassword(value),
  });

  function handleValidSubmit(values: IdentifierFormValues): void {
    const identifier = detectLoginIdentifier(values.identifier, regionConfig);
    if (identifier.kind === 'invalid') return;

    mutation.mutate(values.identifier, {
      onSuccess: (response) => onResult(identifier, response),
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
        noValidate
        className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8"
      >
        <div className="flex flex-col gap-1 text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-balance outline-none"
          >
            {t('forgot.heading')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('forgot.subtext')}</p>
        </div>

        {mutation.isError && (
          <div
            role={mutation.error instanceof RateLimitedError ? 'status' : 'alert'}
            className="flex items-start gap-2.5 rounded-md bg-status-overdue-bg p-3 text-sm text-status-overdue-fg"
          >
            <span>
              {mutation.error instanceof RateLimitedError
                ? mutation.error.retryAfterSeconds !== null
                  ? t('errors.rateLimited', { count: mutation.error.retryAfterSeconds })
                  : t('errors.rateLimitedGeneric')
                : t('errors.generic')}
            </span>
          </div>
        )}

        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="forgot-identifier">{t('forgot.identifierLabel')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id="forgot-identifier"
                  autoComplete="username"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" loading={mutation.isPending} className="w-full">
          {t('forgot.continue')}
        </Button>

        <Link
          to="/login"
          className="relative text-center text-sm text-primary underline after:absolute after:-inset-2 after:content-['']"
        >
          {t('forgot.backToLogin')}
        </Link>
      </form>
    </Form>
  );
}

/** Step 2: OTP entry, phone-channel only (email lands the visitor on
 * `linkSent` instead — there is no code to type for that channel). */
function CodeStep({ phone, onContinue }: { phone: string; onContinue: (otp: string) => void }) {
  const { t } = useTranslation('auth');
  const [otp, setOtp] = React.useState('');
  const [secondsLeft, setSecondsLeft] = React.useState(RESEND_COOLDOWN_SECONDS);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const resendMutation = useMutation({
    mutationFn: () => postAuthForgotPassword(phone),
    onSuccess: () => setSecondsLeft(RESEND_COOLDOWN_SECONDS),
  });

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8">
      <div className="flex flex-col gap-1 text-center">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-balance outline-none"
        >
          {t('forgot.codeHeading')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('forgot.codeSubtext')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="forgot-code" className="text-sm font-medium">
          {t('forgot.codeLabel')}
        </label>
        <OtpInput
          id="forgot-code"
          aria-label={t('forgot.codeLabel')}
          value={otp}
          onValueChange={setOtp}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        disabled={secondsLeft > 0 || resendMutation.isPending}
        onClick={() => resendMutation.mutate()}
      >
        {secondsLeft > 0 ? t('forgot.resendIn', { count: secondsLeft }) : t('forgot.resend')}
      </Button>

      <Button type="button" disabled={otp.length !== 6} onClick={() => onContinue(otp)}>
        {t('forgot.continue')}
      </Button>
    </div>
  );
}

function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<Step>({ kind: 'identifier' });

  const resetMutation = useMutation({
    mutationFn: (input: { phone: string; otp: string; new_password: string }) =>
      resetPassword(queryClient, input),
    onSuccess: (result) => {
      if (result.memberships.length > 1) {
        void navigate({ to: '/select-school' });
      } else {
        void navigate({ to: '/' });
      }
    },
    onError: (error) => {
      // A rejected code sends the visitor back to re-enter it — the OTP
      // itself, not the new password, is what's wrong on a 401.
      if (step.kind === 'password' && error instanceof ApiError && error.statusCode === 401) {
        setStep({ kind: 'code', phone: step.phone });
      }
    },
  });

  if (step.kind === 'identifier') {
    return (
      <AuthScreen>
        <IdentifierStep
          onResult={(identifier, response) => {
            if (identifier.kind === 'phone') {
              setStep({ kind: 'code', phone: identifier.phone });
            } else {
              setStep({ kind: 'linkSent' });
            }
            // `response.debug.otp` (only ever populated behind D6's
            // ACCOUNT_ACCESS_ECHO_SECRETS flag) is what e2e reads —
            // nothing in this UI reads it.
            void response;
          }}
        />
      </AuthScreen>
    );
  }

  if (step.kind === 'linkSent') {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('forgot.sent')}
          explanation={t('forgot.linkExplanation')}
          icon={<MailIcon />}
          onRetry={() => void navigate({ to: '/login' })}
          retryLabel={t('forgot.backToLogin')}
        />
      </AuthScreen>
    );
  }

  if (step.kind === 'code') {
    return (
      <AuthScreen>
        <CodeStep
          phone={step.phone}
          onContinue={(otp) => setStep({ kind: 'password', phone: step.phone, otp })}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <SetPasswordForm
        heading={t('forgot.heading')}
        onSubmit={(password) =>
          resetMutation.mutate({ phone: step.phone, otp: step.otp, new_password: password })
        }
        loading={resetMutation.isPending}
        error={buildResetError(resetMutation.error, t)}
        submitLabel={t('setPassword.submit')}
      />
    </AuthScreen>
  );
}
