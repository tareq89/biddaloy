/**
 * [12.7]'s public link-click confirm for an email contact-change —
 * `ContactChangeDialog`'s email step sends a link here
 * (`${APP_BASE_URL}/verify-email?token=…`), clicked from an inbox on a
 * device that may not have an active session, same reasoning `activate.tsx`
 * and `reset-password.tsx` document for their own `?token=` search param.
 */
import { postAuthVerifyEmail } from '@biddaloy/ui/api';
import { AuthLayout, Button, OtpInput, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck, Link2Off, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
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

  const verifyQuery = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => postAuthVerifyEmail(token as string),
    enabled: !!token,
    retry: false,
  });

  // [75.1] A school's proposal is only shown on open; the person must press Approve or Decline.
  // D23: Approve answers 'confirm' and sends a code to each NEW contact; the change applies only
  // once those codes come back with a second Approve.
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState({ email_code: '', phone_code: '' });
  const decide = useMutation({
    mutationFn: ({
      action,
      codes,
    }: {
      action: 'approve' | 'decline';
      codes?: { email_code?: string; phone_code?: string };
    }) => postAuthVerifyEmail(token as string, action, codes),
    onSuccess: (data) => {
      if (data.status === 'confirm') setConfirming(true);
    },
  });

  const signInButton = (
    <Button asChild className="w-full">
      <Link to="/login">{t('verifyEmail.signIn')}</Link>
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
          <Button variant="outline" className="w-full" onClick={() => void verifyQuery.refetch()}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
          <Button asChild variant="ghost" className="w-full text-primary">
            <Link to="/login">{t('toSignIn')}</Link>
          </Button>
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (decide.data?.status === 'declined') {
    return (
      <AuthLayout>
        <GuestStatus
          icon={CircleCheck}
          tone="success"
          title={t('verifyEmail.proposal.declined', {
            school: verifyQuery.data.proposal?.from_school ?? '',
          })}
        >
          {signInButton}
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (verifyQuery.data.status === 'proposal' && decide.data?.status !== 'valid') {
    if (decide.data && decide.data.status !== 'confirm') {
      // Approve or decline answered with something other than success: the link is stale or spent.
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
    const proposal = verifyQuery.data.proposal;
    const value = (v: string | null | undefined) => v ?? t('verifyEmail.proposal.removed');
    const declineButton = (
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ action: 'decline' })}
      >
        {t('verifyEmail.proposal.decline')}
      </Button>
    );
    if (confirming) {
      // One code field per NEW value (a removal needs none), labelled with the full address (D25).
      const fields = (
        [
          ['email_code', proposal?.new_email],
          ['phone_code', proposal?.new_phone],
        ] as const
      ).filter(([, address]) => address);
      const ready = fields.every(([key]) => codes[key].length === 6);
      return (
        <AuthLayout>
          <GuestStatus
            icon={ShieldQuestion}
            tone="warning"
            title={t('verifyEmail.proposal.codeTitle')}
            explanation={t('verifyEmail.proposal.codeExplanation')}
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                decide.mutate({
                  action: 'approve',
                  codes: Object.fromEntries(fields.map(([k]) => [k, codes[k]])),
                });
              }}
            >
              {fields.map(([key, address]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label htmlFor={`verify-${key}`} className="text-sm font-medium">
                    {t('verifyEmail.proposal.codeLabel', { value: address })}
                  </label>
                  <OtpInput
                    id={`verify-${key}`}
                    value={codes[key]}
                    onValueChange={(v) => setCodes((c) => ({ ...c, [key]: v }))}
                    invalid={decide.isError}
                    aria-label={t('verifyEmail.proposal.codeLabel', { value: address })}
                  />
                </div>
              ))}
              {decide.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('verifyEmail.proposal.codeError')}
                </p>
              )}
              <Button type="submit" className="w-full" loading={decide.isPending} disabled={!ready}>
                {t('verifyEmail.proposal.confirm')}
              </Button>
              {declineButton}
            </form>
          </GuestStatus>
        </AuthLayout>
      );
    }
    return (
      <AuthLayout>
        <GuestStatus
          icon={ShieldQuestion}
          tone="warning"
          title={t('verifyEmail.proposal.title', { school: proposal?.from_school ?? '' })}
          explanation={t('verifyEmail.proposal.explanation')}
        >
          <ul className="flex flex-col gap-1 text-sm">
            {proposal?.new_email !== undefined && (
              <li>{t('verifyEmail.proposal.newEmail', { value: value(proposal.new_email) })}</li>
            )}
            {proposal?.new_phone !== undefined && (
              <li>{t('verifyEmail.proposal.newPhone', { value: value(proposal.new_phone) })}</li>
            )}
          </ul>
          {decide.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('verifyEmail.proposal.error')}
            </p>
          )}
          <Button
            className="w-full"
            loading={decide.isPending}
            onClick={() => decide.mutate({ action: 'approve' })}
          >
            {t('verifyEmail.proposal.approve')}
          </Button>
          {declineButton}
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (verifyQuery.data.status !== 'valid' && decide.data?.status !== 'valid') {
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
