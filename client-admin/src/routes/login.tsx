import { ApiError, NoMembershipsError, RateLimitedError } from '@biddaloy/ui/api';
import { SignInForm, type SignInCredentials, type SignInFormError } from '@biddaloy/ui/components';
import { login } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { AuthScreen } from './-auth-screen';

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

  const mutation = useMutation({
    mutationFn: (credentials: SignInCredentials) => login(queryClient, credentials),
    onSuccess: (result) => {
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

  return (
    <AuthScreen>
      <SignInForm
        onSubmit={(credentials) => mutation.mutate(credentials)}
        loading={mutation.isPending}
        error={buildLoginError(mutation.error, t)}
        secondaryAction={
          <Link to="/forgot-password" className="text-primary underline">
            {t('forgot.link')}
          </Link>
        }
      />
    </AuthScreen>
  );
}
