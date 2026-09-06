/**
 * [12.7]'s public link-click confirm for an email contact-change —
 * `ContactChangeDialog`'s email step sends a link here
 * (`${APP_BASE_URL}/verify-email?token=…`), clicked from an inbox on a
 * device that may not have an active session, same reasoning `activate.tsx`
 * and `reset-password.tsx` document for their own `?token=` search param.
 */
import { postAuthVerifyEmail } from '@biddaloy/ui/api';
import { Button, RouteStatusState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthScreen } from './-auth-screen';

/** Same "a bad link is a real, reachable case" reasoning as `activate.tsx`'s
 * identical schema comment. */
const verifyEmailSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/verify-email')({
  validateSearch: verifyEmailSearchSchema,
  component: VerifyEmailPage,
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

function VerifyEmailPage() {
  const { t } = useTranslation('auth');
  const { token } = Route.useSearch();
  const navigate = useNavigate();

  const verifyQuery = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => postAuthVerifyEmail(token as string),
    enabled: !!token,
    retry: false,
  });

  if (!token) {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('verifyEmail.missingToken')}
          explanation={t('verifyEmail.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void navigate({ to: '/login' })}
          retryLabel={t('verifyEmail.signIn')}
        />
      </AuthScreen>
    );
  }

  if (verifyQuery.isPending) {
    return (
      <AuthScreen>
        <div
          role="status"
          aria-label={t('activate.verifying')}
          className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-card p-8"
        >
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthScreen>
    );
  }

  if (verifyQuery.isError || !verifyQuery.data) {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('errors.generic')}
          explanation={t('verifyEmail.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void verifyQuery.refetch()}
          retryLabel={t('submit.action')}
        />
      </AuthScreen>
    );
  }

  if (verifyQuery.data.status !== 'valid') {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('verifyEmail.linkExpired')}
          explanation={t('verifyEmail.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void navigate({ to: '/login' })}
          retryLabel={t('verifyEmail.signIn')}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border-subtle bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">{t('verifyEmail.success')}</h1>
        <p className="text-sm text-muted-foreground">{t('verifyEmail.successSubtext')}</p>
        <Button type="button" onClick={() => void navigate({ to: '/login' })}>
          {t('verifyEmail.signIn')}
        </Button>
      </div>
    </AuthScreen>
  );
}
