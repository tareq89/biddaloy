/**
 * [12.7]'s public link-click confirm for an email contact-change —
 * `ContactChangeDialog`'s email step sends a link here
 * (`${APP_BASE_URL}/verify-email?token=…`), clicked from an inbox on a
 * device that may not have an active session, same reasoning `activate.tsx`
 * and `reset-password.tsx` document for their own `?token=` search param.
 */
import { postAuthVerifyEmail } from '@biddaloy/ui/api';
import { AuthLayout, Button, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleCheck, Link2Off, TriangleAlert } from 'lucide-react';
import { z } from 'zod';

import { GuestStatus } from './-guest-status';

/** Same "a bad link is a real, reachable case" reasoning as `activate.tsx`'s
 * identical schema comment. */
const verifyEmailSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/verify-email')({
  validateSearch: verifyEmailSearchSchema,
  component: VerifyEmailPage,
});

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

  const signInButton = (
    <Button className="w-full" onClick={() => void navigate({ to: '/login' })}>
      {t('verifyEmail.signIn')}
    </Button>
  );

  if (!token) {
    return (
      <AuthLayout>
        <GuestStatus
          icon={Link2Off}
          tone="warning"
          title={t('verifyEmail.missingToken')}
          explanation={t('verifyEmail.linkExplanation')}
        >
          {signInButton}
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (verifyQuery.isPending) {
    return (
      <AuthLayout>
        <div
          role="status"
          aria-busy="true"
          aria-label={t('activate.verifying')}
          className="flex flex-col gap-4"
        >
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (verifyQuery.isError || !verifyQuery.data) {
    return (
      <AuthLayout>
        <GuestStatus icon={TriangleAlert} tone="danger" title={t('errors.generic')}>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void verifyQuery.refetch()}
          >
            {t('common:actions.retry')}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-primary"
            onClick={() => void navigate({ to: '/login' })}
          >
            {t('toSignIn')}
          </Button>
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (verifyQuery.data.status !== 'valid') {
    return (
      <AuthLayout>
        <GuestStatus
          icon={Link2Off}
          tone="warning"
          title={t('verifyEmail.linkExpired')}
          explanation={t('verifyEmail.linkExplanation')}
        >
          {signInButton}
        </GuestStatus>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <GuestStatus
        icon={CircleCheck}
        tone="success"
        title={t('verifyEmail.success')}
        explanation={t('verifyEmail.successSubtext')}
      >
        {signInButton}
      </GuestStatus>
    </AuthLayout>
  );
}
