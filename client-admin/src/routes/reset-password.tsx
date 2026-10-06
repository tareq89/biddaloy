/**
 * 12.4's second recovery route: the emailed reset-link landing page. A
 * separate route from `/forgot-password` (per the plan's "Plan
 * corrections" #2) because this one jumps straight to the new-password
 * step from a `?token=` search param instead of walking the identifier/
 * OTP steps — the token itself already proves the identity check
 * `/forgot-password`'s OTP step exists to do.
 */
import { ApiError, RateLimitedError } from '@biddaloy/ui/api';
import {
  AuthLayout,
  Button,
  SetPasswordForm,
  type SignInFormError,
  weakPasswordRules,
} from '@biddaloy/ui/components';
import { resetPassword } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Link2Off } from 'lucide-react';
import { z } from 'zod';

import { GuestStatus } from './-guest-status';

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

function BadLink({ title }: { title: string }) {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  return (
    <GuestStatus
      icon={Link2Off}
      tone="warning"
      title={title}
      explanation={t('forgot.linkExplanation')}
    >
      <Button className="w-full" onClick={() => void navigate({ to: '/forgot-password' })}>
        {t('forgot.requestNew')}
      </Button>
      <Button
        variant="ghost"
        className="w-full text-primary"
        onClick={() => void navigate({ to: '/login' })}
      >
        {t('toSignIn')}
      </Button>
    </GuestStatus>
  );
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
      <AuthLayout>
        <BadLink title={t('forgot.invalidLink')} />
      </AuthLayout>
    );
  }

  if (mutation.isError && mutation.error instanceof ApiError && mutation.error.statusCode === 401) {
    return (
      <AuthLayout>
        <BadLink title={t('forgot.linkExpired')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <SetPasswordForm
        heading={t('reset.heading')}
        subtext={t('reset.subtext')}
        onSubmit={(password) => mutation.mutate(password)}
        loading={mutation.isPending}
        error={buildResetError(mutation.error, t)}
        // Anonymous here and there is no reset-verify call, so the audience is
        // unknown: staff rules are the stricter set. If the server judges by
        // the family rules it accepts these too; `failedRules` covers the rest.
        audience="staff"
        failedRules={weakPasswordRules(mutation.error)}
        submitLabel={t('setPassword.submit')}
      />
    </AuthLayout>
  );
}
