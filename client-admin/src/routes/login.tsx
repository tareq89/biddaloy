import {
  ApiError,
  getAccessToken,
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
  logout,
  requestOtp,
  socialProvidersQueryOptions,
  socialStartUrl,
  verifyOtp,
  type OtpLoginResult,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { ChevronRightIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { DemoCornerFrame } from '../features/demo/demo-corner-frame';
import { DemoInboxWarning } from '../features/demo/demo-inbox-warning';
import { DemoRoleCards } from '../features/demo/demo-role-cards';
import { TestInboxHint } from '../features/demo/test-environment-notice';
import { useDemoMode, type DemoRoleCard } from '../features/demo/use-demo-mode';
import { FirstPasswordStep } from '../features/first-password/first-password-step';
import { isSameAppRedirect } from '../same-app-redirect';

/**
 * The protected-route guard (`__root.tsx`'s `beforeLoad`) redirects every
 * unauthenticated visit here, with `?redirect=` set to the page they were
 * actually trying to reach — validated same-app below so a login form can
 * navigate back to it safely (`isSameAppRedirect`).
 */
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
  // 50.8: the landing's `/login?role=<key>` signs in as that demo card. Only ever matched against
  // the demo cards (never echoed); anything else, or a non-demo host, ignores it (D8).
  role: z.string().max(40).optional().catch(undefined),
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
  const demo = useDemoMode();
  // Demo only: the "own account" form starts folded under the role cards. A failed card opens it
  // (the form shows the error), and so does focus inside it; nothing closes it but the user.
  const [ownOpen, setOwnOpen] = React.useState(false);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
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
    onError: () => setOwnOpen(true),
  });

  // 50.8: fire once per page load; `role` leaves the URL so a reload does not sign in again.
  // `mutate` is stable across renders (the `mutation` object is not), so keep it in a ref.
  const roleFired = React.useRef(false);
  const signInRef = React.useRef(mutation.mutate);
  signInRef.current = mutation.mutate;
  React.useEffect(() => {
    if (!demo.enabled || !search.role || roleFired.current) return;
    const card = demo.cards.find((c) => c.key === search.role);
    if (!card) return;
    roleFired.current = true;
    void navigate({
      to: '/login',
      search: (prev) => ({ ...prev, role: undefined }),
      replace: true,
    });
    // Already signed in (the root guard has finished its silent refresh by now): never swap the session.
    if (getAccessToken()) return;
    signInRef.current({ email: card.email, password: demo.password });
  }, [demo.enabled, demo.cards, demo.password, search.role, navigate]);

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

  // Someone else's owed card (a shared PC) must not lock out the next person.
  // `logout` clears the gate; the bump re-renders even when the URL is unchanged.
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  function signOut(): void {
    void logout(queryClient).finally(() => {
      setPasswordStep(null);
      rerender();
      void navigate({ to: '/login', search: {}, replace: true });
    });
  }

  // A reload (or another tab) while a staff password is still owed, whatever the
  // URL says: `?step=password` from `_staff`, or `?mode=code` after the in-page step.
  const owedRoles = passwordStep ? null : getFirstPasswordGate();
  if (owedRoles) {
    return (
      <AuthLayout>
        <FirstPasswordStep
          roles={owedRoles}
          passwordRequired
          onDone={() => void navigate({ to: search.redirect ?? '/' })}
          onSignOut={signOut}
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
          onSignOut={signOut}
        />
      </AuthLayout>
    );
  }

  const form = (
    <>
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
            headingLevel={demo.enabled ? 'h2' : 'h1'}
            onSubmit={(credentials) => {
              roleFired.current = true; // a manual sign-in cancels a pending ?role= deep link
              mutation.mutate(credentials);
            }}
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
            from="/login"
            to="/login"
            search={(prev) => ({ ...prev, method: undefined, mode: 'code' })}
            replace
            className="mt-4 flex h-11 w-full items-center justify-center rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
          >
            {t('login.firstTime')}
          </Link>
        </TabsContent>
        <TabsContent value="otp">
          <DemoInboxWarning className="mb-3" />
          <OtpSignInForm
            headingLevel={demo.enabled ? 'h2' : 'h1'}
            onRequest={(phone) => otpRequestMutation.mutateAsync(phone).then(() => undefined)}
            onVerify={(credentials) => {
              roleFired.current = true;
              otpVerifyMutation.mutate(credentials);
            }}
            loading={otpVerifyMutation.isPending}
            error={buildOtpError(otpVerifyMutation.error ?? otpRequestMutation.error, t)}
          />
          <TestInboxHint className="mt-3 text-caption text-text-secondary" />
        </TabsContent>
      </Tabs>
    </>
  );

  // One tree, demo or not: `GET /demo/roles` answers after the first paint, and a different tree
  // would remount the form (typed input, focus and the open tab lost). Only siblings toggle.
  return (
    <DemoCornerFrame>
      <AuthLayout size={demo.enabled ? 'wide' : 'default'} reserveCorner={demo.enabled}>
        {demo.enabled && (
          <DemoLoginIntro
            cards={demo.cards}
            disabled={mutation.isPending}
            onPick={(card) => mutation.mutate({ email: card.email, password: demo.password })}
            ownOpen={ownOpen}
            onToggleOwn={() => setOwnOpen((open) => !open)}
          />
        )}
        {/* Focus here before a cold `/demo/roles` answer means the visitor is typing: keep the
            form open and the cards from stealing focus (Enter would sign in as Admin). */}
        <div
          id={OWN_ACCOUNT_ID}
          onFocus={() => setOwnOpen(true)}
          hidden={demo.enabled && !ownOpen}
          className={demo.enabled ? 'mt-4' : undefined}
        >
          {form}
        </div>
        {demo.enabled && <DemoLoginFooter />}
      </AuthLayout>
    </DemoCornerFrame>
  );
}

const OWN_ACCOUNT_ID = 'demo-own-account';

/** Demo-only header: title, role cards and the "own account" toggle. Mounted only in the demo, so
 * a normal school never loads the `demo` translations (`useDemoMode` loads them first). */
function DemoLoginIntro({
  cards,
  disabled,
  onPick,
  ownOpen,
  onToggleOwn,
}: {
  cards: DemoRoleCard[];
  disabled: boolean;
  onPick: (card: DemoRoleCard) => void;
  ownOpen: boolean;
  onToggleOwn: () => void;
}) {
  const { t: tDemo } = useTranslation('demo'); // aliased: check-i18n reads bare t() as 'auth'
  return (
    <>
      <h1 className="text-h2">{tDemo('title')}</h1>
      <p className="mt-1 mb-4 text-text-secondary">{tDemo('subtitle')}</p>
      <DemoRoleCards cards={cards} disabled={disabled} onPick={onPick} focusFirst={!ownOpen} />
      <button
        type="button"
        aria-expanded={ownOpen}
        aria-controls={OWN_ACCOUNT_ID}
        onClick={onToggleOwn}
        className="mt-5 flex items-center gap-1 text-body-lg font-medium text-primary"
      >
        <ChevronRightIcon aria-hidden="true" className={ownOpen ? 'size-4 rotate-90' : 'size-4'} />
        {tDemo('ownAccount')}
      </button>
    </>
  );
}

function DemoLoginFooter() {
  const { t: tDemo } = useTranslation('demo'); // aliased: check-i18n reads bare t() as 'auth'
  return <p className="mt-5 text-caption text-text-secondary">{tDemo('footer')}</p>;
}
