/**
 * 12.4's second recovery route: the emailed reset-link landing page. A
 * separate route from `/forgot-password` (per the plan's "Plan
 * corrections" #2) because this one jumps straight to the new-password
 * step from a `?token=` search param instead of walking the identifier/
 * OTP steps — the token itself already proves the identity check
 * `/forgot-password`'s OTP step exists to do.
 */
import { ApiError, RateLimitedError } from '@biddaloy/ui/api';
import { RouteStatusState, SetPasswordForm, type SignInFormError } from '@biddaloy/ui/components';
import { resetPassword } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { AuthScreen } from './-auth-screen';

/** Same "a bad link is a real, reachable case" reasoning as `activate.tsx`'s
 * identical schema comment — a missing/malformed `?token=` falls back to
 * `undefined` rather than a router-level 404. */
const resetPasswordSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetPasswordSearchSchema,
  component: ResetPasswordPage,
});

/** Decorative, `aria-hidden` — matches `activate.tsx`'s `LinkIcon`. */
function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-8">
      <path
        d="M8.5 11.5a3 3 0 0 0 4.24 0l2-2a3 3 0 1 0-4.24-4.24l-.5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M11.5 8.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 1 0 4.24 4.24l.5-.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mirrors `activate.tsx`'s `buildActivateError` — a 401 here means the
 * token is invalid/expired/consumed, handled by the caller switching to
 * the "link expired" card rather than a banner. */
function buildResetError(error: unknown, t: TFunction<'auth'>): SignInFormError | null {
  if (!error) return null;

  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? { message: t('errors.rateLimited', { count: error.retryAfterSeconds }), tone: 'status' }
      : { message: t('errors.rateLimitedGeneric'), tone: 'status' };
  }

  if (error instanceof ApiError && error.statusCode === 401) {
    // Handled by the caller switching to the "expired" card.
    return null;
  }

  return { message: t('errors.generic'), tone: 'alert' };
}

function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (password: string) =>
      resetPassword(queryClient, { token: token as string, new_password: password }),
    onSuccess: (result) => {
      if (result.memberships.length > 1) {
        void navigate({ to: '/select-school' });
      } else {
        void navigate({ to: '/' });
      }
    },
  });

  if (!token) {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('forgot.invalidLink')}
          explanation={t('forgot.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void navigate({ to: '/forgot-password' })}
          retryLabel={t('forgot.link')}
        />
      </AuthScreen>
    );
  }

  if (mutation.isError && mutation.error instanceof ApiError && mutation.error.statusCode === 401) {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('forgot.linkExpired')}
          explanation={t('forgot.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void navigate({ to: '/forgot-password' })}
          retryLabel={t('forgot.link')}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <SetPasswordForm
        heading={t('forgot.heading')}
        onSubmit={(password) => mutation.mutate(password)}
        loading={mutation.isPending}
        error={buildResetError(mutation.error, t)}
        submitLabel={t('setPassword.submit')}
      />
    </AuthScreen>
  );
}
