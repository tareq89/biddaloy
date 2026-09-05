import type { PasswordChangeRequiredResponse } from '@biddaloy/shared';
import { ApiError, NoMembershipsError, RateLimitedError } from '@biddaloy/ui/api';
import {
  CompletePasswordResetForm,
  LocaleSwitcher,
  SignInForm,
  ThemeToggle,
  type SignInCredentials,
  type SignInFormError,
} from '@biddaloy/ui/components';
import { completePasswordReset, login, useDensity } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';
import { z } from 'zod';

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

function LoginPage() {
  const { t } = useTranslation('auth');
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // [8.13.8] Comfortable density (contract section 6). Auth screens sit with
  // `/portal` rather than with the staff routes because they are
  // PRE-authentication: at this point nobody knows whether the visitor is a
  // guardian on a 360 px phone or an administrator on a desktop, so the
  // accessible 44 px target is the safe default for the unknown user.
  //
  // Set on `document.documentElement`, not on the wrapper below, so the
  // portalled `LocaleSwitcher` menu inherits it too — see `useDensity`.
  useDensity('comfortable');

  const [challenge, setChallenge] = React.useState<PasswordChangeRequiredResponse>();
  const [completed, setCompleted] = React.useState(false);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const completionGeneration = React.useRef(0);
  const completion = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: completePasswordReset,
  });

  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: (credentials: SignInCredentials) => login(queryClient, credentials),
    onSuccess: (result) => {
      if (!live.current) return;
      if ('password_change_required' in result) {
        setChallenge(result);
        setCompleted(false);
        mutation.reset();
        return;
      }
      // [8.9.5]: `login()` deliberately leaves the active tenant unset for
      // 2+ memberships (no silent pick) — send that visitor to the picker
      // instead, carrying the same `redirect` through so it can hand off
      // to the originally-requested page once a school is chosen.
      if (result.memberships.length > 1) {
        void navigate({ to: '/select-school', search: { redirect: search.redirect } });
      } else {
        void navigate({ to: search.redirect ?? '/' });
      }
    },
  });

  const resetLogin = mutation.reset;
  const resetCompletion = completion.reset;
  React.useEffect(
    () => () => {
      completionGeneration.current += 1;
      resetLogin();
      resetCompletion();
    },
    [resetLogin, resetCompletion],
  );

  return (
    // No `value` override: `useTenantRegionConfig()` needs an active
    // tenant, which doesn't exist yet at the point a visitor is signing
    // in — `RegionConfigProvider` already falls back to
    // `LOCALE_REGION_DEFAULTS[locale]` with no `value` passed, which is
    // exactly the right default here.
    <RegionConfigProvider>
      <div className="flex min-h-screen flex-col bg-muted/20">
        <div className="flex justify-end gap-2 p-4">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm">
            {challenge ? (
              <CompletePasswordResetForm
                onSubmit={({ new_password }) => {
                  const generation = completionGeneration.current;
                  completion.mutate(
                    { reset_token: challenge.reset_token, new_password },
                    {
                      onSuccess: () => {
                        if (!live.current || generation !== completionGeneration.current) return;
                        setChallenge(undefined);
                        setCompleted(true);
                        completion.reset();
                        mutation.reset();
                      },
                    },
                  );
                }}
                onCancel={() => {
                  completionGeneration.current += 1;
                  setChallenge(undefined);
                  completion.reset();
                  mutation.reset();
                }}
                submitting={completion.isPending}
                serverError={
                  completion.error
                    ? {
                        message:
                          completion.error instanceof RateLimitedError
                            ? t('errors.rateLimitedGeneric')
                            : t('reset.errors.invalid'),
                      }
                    : null
                }
              />
            ) : (
              <>
                {completed && (
                  <p role="status" className="mb-4 text-sm">
                    {t('reset.success')}
                  </p>
                )}
                <SignInForm
                  onSubmit={(credentials) => {
                    setCompleted(false);
                    mutation.mutate(credentials);
                  }}
                  loading={mutation.isPending}
                  error={buildLoginError(mutation.error, t)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </RegionConfigProvider>
  );
}
