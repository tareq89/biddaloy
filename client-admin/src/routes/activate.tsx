import {
  ApiError,
  postAuthActivateResend,
  postAuthActivateVerify,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  Button,
  Input,
  RouteStatusState,
  SetPasswordForm,
  Skeleton,
} from '@biddaloy/ui/components';
import type { SignInFormError } from '@biddaloy/ui/components';
import { activate } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';
import { z } from 'zod';

import { AuthScreen } from './-auth-screen';

/** The token is `.optional().catch(undefined)` rather than required — a
 * malformed or missing `?token=` is a real, reachable case (a bad copy-
 * paste, an email client mangling the link) and the "missing-token" state
 * below has honest copy for it, not a router-level 404. */
const activateSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/activate')({
  validateSearch: activateSearchSchema,
  component: ActivatePage,
});

type TerminalStatus = 'expired' | 'consumed' | 'revoked' | 'unknown';

const TERMINAL_STATUSES: readonly TerminalStatus[] = ['expired', 'consumed', 'revoked', 'unknown'];

function isTerminalStatus(value: string): value is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(value);
}

/** Mirrors `login.tsx`'s `buildLoginError` — never the raw `ApiError`
 * message, only translated copy a user can act on. */
function buildActivateError(error: unknown, t: TFunction<'auth'>): SignInFormError | null {
  if (!error) return null;

  if (error instanceof RateLimitedError) {
    return error.retryAfterSeconds !== null
      ? { message: t('errors.rateLimited', { count: error.retryAfterSeconds }), tone: 'status' }
      : { message: t('errors.rateLimitedGeneric'), tone: 'status' };
  }

  if (error instanceof ApiError && isTerminalStatus(error.message)) {
    // Handled by the caller switching to the matching terminal card — no
    // banner needed for this case.
    return null;
  }

  return { message: t('errors.generic'), tone: 'alert' };
}

/** Decorative, `aria-hidden` — matches the icon convention `RouteStatusState`
 * expects its callers to supply. */
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

/** The small self-service resend form the plan corrects the issue's own
 * wording into — enumeration-safe, so it always shows the same "done"
 * copy regardless of what actually happened server-side. */
function ResendForm() {
  const { t } = useTranslation('auth');
  const [identifier, setIdentifier] = React.useState('');
  const mutation = useMutation({
    mutationFn: () => postAuthActivateResend(identifier),
  });

  if (mutation.isSuccess) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('activate.resendDone')}
      </p>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <label htmlFor="activate-resend-identifier" className="sr-only">
        {t('activate.resendLabel')}
      </label>
      <Input
        id="activate-resend-identifier"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        placeholder={t('activate.resendLabel')}
        disabled={mutation.isPending}
      />
      <Button type="submit" loading={mutation.isPending} disabled={!identifier.trim()}>
        {t('activate.resendAction')}
      </Button>
    </form>
  );
}

function TerminalCard({ status }: { status: TerminalStatus }) {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-4">
      <RouteStatusState
        title={t(`activate.${status}`)}
        explanation={t('activate.linkExplanation')}
        icon={<LinkIcon />}
        onRetry={() => void navigate({ to: '/login' })}
        retryLabel={t('submit.action')}
      />
      {(status === 'expired' || status === 'revoked') && <ResendForm />}
    </div>
  );
}

function ActivatePage() {
  const { t } = useTranslation('auth');
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // `overrideStatus` lets a mid-activation failure (the token got consumed
  // by another tab between "verify" and "submit", say) switch straight to
  // the matching terminal card, without re-running verify.
  const [overrideStatus, setOverrideStatus] = React.useState<TerminalStatus | null>(null);

  const verifyQuery = useQuery({
    queryKey: ['activate-verify', token],
    queryFn: () => postAuthActivateVerify(token as string),
    enabled: !!token,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (password: string) => activate(queryClient, { token: token as string, password }),
    onSuccess: (result) => {
      // [8.9.5]: 2+ memberships go to the picker; 1 lets `/` (or wherever
      // `__root.tsx`'s guard eventually sends them) resolve on its own —
      // same contract as login.tsx:104-110.
      if (result.memberships.length > 1) {
        void navigate({ to: '/select-school' });
      } else {
        void navigate({ to: '/' });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && isTerminalStatus(error.message)) {
        setOverrideStatus(error.message);
      }
    },
  });

  if (!token) {
    return (
      <AuthScreen>
        <RouteStatusState
          title={t('activate.missingToken')}
          explanation={t('activate.linkExplanation')}
          icon={<LinkIcon />}
          onRetry={() => void navigate({ to: '/login' })}
          retryLabel={t('submit.action')}
        />
      </AuthScreen>
    );
  }

  if (overrideStatus) {
    return (
      <AuthScreen>
        <TerminalCard status={overrideStatus} />
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
          <Skeleton className="h-10 w-full" />
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
          explanation={t('activate.linkExplanation')}
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
        <TerminalCard status={verifyQuery.data.status} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <SetPasswordForm
        heading={t('activate.welcome', {
          name: verifyQuery.data.full_name,
          school: verifyQuery.data.school_name,
        })}
        onSubmit={(password) => mutation.mutate(password)}
        loading={mutation.isPending}
        error={buildActivateError(mutation.error, t)}
        submitLabel={t('setPassword.submit')}
      />
    </AuthScreen>
  );
}
