import {
  ApiError,
  getFirstPasswordGate,
  NoMembershipsError,
  RateLimitedError,
  requireFirstPassword,
} from '@biddaloy/ui/api';
import {
  AuthLayout,
  NoticeBar,
  OtpSignInForm,
  SignInForm,
  SocialButtons,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type OtpSignInCredentials,
  type SignInCredentials,
  type SignInFormError,
} from '@biddaloy/ui/components';
import {
  login,
  requestOtp,
  socialProvidersQueryOptions,
  socialStartUrl,
  verifyOtp,
  type OtpLoginResult,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';
import { z } from 'zod';

import { FirstPasswordStep } from '../features/first-password/first-password-step';

/**
 * The protected-route guard (`__root.tsx`'s `beforeLoad`) redirects every
 * unauthenticated visit here, with `?redirect=` set to the page they were
 * actually trying to reach — validated same-app below so a login form can
 * navigate back to it safely.
 */
/** A fixed, non-routable base for probing where `value` resolves to — not
 * `window.location.origin`, so this stays a pure function testable without
 * a browser. `value.startsWith('/')` alone isn't enough: browsers resolve
 * a leading `\` the same as `/` (WHATWG URL spec), so `/\evil.com` and
 * `//evil.com` both resolve off-origin despite starting with a single
 * `/` — checking the *resolved* origin against the probe catches both. */
const REDIRECT_PROBE_ORIGIN = 'http://redirect-probe.invalid';

function isSameAppRedirect(value: string): boolean {
  if (!value.startsWith('/')) return false;
  try {
    return new URL(value, REDIRECT_PROBE_ORIGIN).origin === REDIRECT_PROBE_ORIGIN;
  } catch {
    return false;
  }
}

const loginSearchSchema = z.object({
  // Same-app relative path only — anything that resolves off-origin
  // (`//evil.com`, `/\evil.com`, and the equivalent percent-encoded form
  // `/%5Cevil.com`, which the router decodes before this schema ever sees
  // it) falls back to `undefined` via `.catch()`, the same defensive shape
  // `students/index.tsx`'s schema already uses.
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
  // 12.5: `/login?method=otp` deep-links straight to the "Sign in with
  // code" tab (used by e2e) — anything else falls back to the default
  // `password` tab rather than erroring.
  method: z.enum(['password', 'otp']).optional().catch(undefined),
  // 13.5: `?mode=code` opens the code form (the "First time here?" link).
  mode: z.enum(['code']).optional().catch(undefined),
  // 13.4: the social callback sends a visitor back with `?social=not_linked`
  // when the provider account is not connected to any user.
  social: z.enum(['not_linked']).optional().catch(undefined),
  // 13.5.3: `_staff` sends a session that still owes a first password here.
  step: z.enum(['password']).optional().catch(undefined),
});

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

/** Maps whatever `login()` (`@biddaloy/ui/hooks`) rejected with onto plain,
 * translated copy for `SignInForm`'s banner — never the raw `ApiError`
 * message or a JSON body, per the issue's own AC. `RateLimitedError` and
 * `NoMembershipsError` are `ui`'s own typed errors (see `ui/src/api/errors.ts`);
 * everything else (a genuine 401, a network failure) collapses to the same
 * "invalid credentials" / generic copy a user can actually act on. */
function buildLoginError(error: unknown, t: TFunction<'auth'>): SignInFormError | null {
  if (!error) return null;

  if (error instanceof RateLimitedError) {
    // `count` (not `seconds`) is i18next's own option name for selecting a
    // plural form — `errors.rateLimited_one`/`_other` in the locale files
    // (see check-i18n-keys.mjs's PLURAL_SUFFIXES) resolve off of it.
    return error.retryAfterSeconds !== null
      ? { message: t('errors.rateLimited', { count: error.retryAfterSeconds }), tone: 'status' }
      : { message: t('errors.rateLimitedGeneric'), tone: 'status' };
  }

  if (error instanceof NoMembershipsError) {
    return { message: t('errors.noMemberships'), tone: 'alert' };
  }

  if (error instanceof ApiError && error.statusCode === 401) {
    return { message: t('errors.invalidCredentials'), tone: 'alert' };
  }

  return { message: t('errors.generic'), tone: 'alert' };
}

/** 12.5's clone of `buildLoginError` for the OTP tab — same typed-error
 * shapes, but a 401 here means "wrong/expired code", not "wrong password". */
function buildOtpError(error: unknown, t: TFunction<'auth'>): SignInFormError | null {
  if (!error) return null;

  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? { message: t('errors.rateLimited', { count: error.retryAfterSeconds }), tone: 'status' }
      : { message: t('errors.rateLimitedGeneric'), tone: 'status' };
  }

  if (error instanceof NoMembershipsError) {
    return { message: t('errors.noMemberships'), tone: 'alert' };
  }

  if (error instanceof ApiError && error.statusCode === 401) {
    return { message: t('otp.errors.invalidCode'), tone: 'alert' };
  }

  return { message: t('errors.generic'), tone: 'alert' };
}

function LoginPage() {
  const { t } = useTranslation('auth');
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function handleSuccess(result: { memberships: { tenantId: string }[] }): void {
    // [8.9.5]: `login()`/`verifyOtp()` deliberately leave the active tenant
    // unset for 2+ memberships (no silent pick) — send that visitor to the
    // picker instead, carrying the same `redirect` through so it can hand
    // off to the originally-requested page once a school is chosen.
    if (result.memberships.length > 1) {
      void navigate({ to: '/select-school', search: { redirect: search.redirect } });
    } else {
      void navigate({ to: search.redirect ?? '/' });
    }
  }

  const mutation = useMutation({
    mutationFn: (credentials: SignInCredentials) => login(queryClient, credentials),
    onSuccess: handleSuccess,
  });

  const otpRequestMutation = useMutation({
    mutationFn: (identifier: string) => requestOtp(identifier),
  });

  const otpVerifyMutation = useMutation({
    mutationFn: (credentials: OtpSignInCredentials) => verifyOtp(queryClient, credentials),
    // A first code sign-in asks for a password in the same card before moving on.
    onSuccess: (result) => {
      if (!result.needs_password) return handleSuccess(result);
      // Survives a reload / new tab: `_staff` sends the user back here until it is set.
      if (result.password_required) requireFirstPassword(result.memberships.map((m) => m.role));
      setPasswordStep(result);
    },
  });

  const [passwordStep, setPasswordStep] = React.useState<OtpLoginResult | null>(null);
  const providers = useQuery(socialProvidersQueryOptions()).data ?? [];
  const tab = search.mode === 'code' || search.method === 'otp' ? 'otp' : 'password';

  function selectTab(value: string): void {
    void navigate({
      to: '/login',
      search: (prev) => ({
        ...prev,
        method: undefined,
        mode: value === 'otp' ? 'code' : undefined,
      }),
      replace: true,
    });
  }

  // A reload (or another tab) while a staff password is still owed.
  const owedRoles = search.step === 'password' && !passwordStep ? getFirstPasswordGate() : null;
  if (owedRoles) {
    return (
      <AuthLayout>
        <FirstPasswordStep
          roles={owedRoles}
          passwordRequired
          onDone={() => void navigate({ to: search.redirect ?? '/' })}
        />
      </AuthLayout>
    );
  }

  if (passwordStep) {
    return (
      <AuthLayout>
        <FirstPasswordStep
          roles={passwordStep.memberships.map((m) => m.role)}
          passwordRequired={passwordStep.password_required}
          onDone={() => handleSuccess(passwordStep)}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      {search.social === 'not_linked' && (
        <NoticeBar tone="info" className="mb-5 rounded-md py-2">
          {t('login.socialNotLinked')}
        </NoticeBar>
      )}
      <SocialButtons
        providers={providers}
        labelFor={(provider) => t(`login.${provider}`)}
        hrefFor={(provider) => socialStartUrl(provider, 'login', search.redirect)}
        className="mb-5"
      />
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="mb-5 w-full">
          <TabsTrigger value="password" className="flex-1">
            {t('tabs.password')}
          </TabsTrigger>
          <TabsTrigger value="otp" className="flex-1">
            {t('tabs.otp')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <SignInForm
            onSubmit={(credentials) => mutation.mutate(credentials)}
            loading={mutation.isPending}
            error={buildLoginError(mutation.error, t)}
            secondaryAction={
              <Link
                to="/forgot-password"
                className="flex h-11 w-full items-center justify-center rounded-md px-3 text-body-lg font-medium text-primary hover:bg-muted"
              >
                {t('forgot.link')}
              </Link>
            }
          />
          <Link
            to="/login"
            search={(prev) => ({ ...prev, method: undefined, mode: 'code' })}
            replace
            className="mt-4 flex h-11 w-full items-center justify-center rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
          >
            {t('login.firstTime')}
          </Link>
        </TabsContent>
        <TabsContent value="otp">
          <OtpSignInForm
            onRequest={(phone) => otpRequestMutation.mutateAsync(phone).then(() => undefined)}
            onVerify={(credentials) => otpVerifyMutation.mutate(credentials)}
            loading={otpVerifyMutation.isPending}
            error={buildOtpError(otpVerifyMutation.error ?? otpRequestMutation.error, t)}
          />
        </TabsContent>
      </Tabs>
    </AuthLayout>
  );
}
