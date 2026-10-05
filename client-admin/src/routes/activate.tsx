import {
  ApiError,
  postAuthActivateResend,
  postAuthActivateVerify,
  RateLimitedError,
} from '@biddaloy/ui/api';
import {
  AuthLayout,
  Button,
  Input,
  Label,
  SetPasswordForm,
  Skeleton,
} from '@biddaloy/ui/components';
import type { SignInFormError } from '@biddaloy/ui/components';
import { activate } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { detectLoginIdentifier } from '@biddaloy/ui/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { CircleCheck, Link2Off, TriangleAlert, UserX } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { GuestStatus } from './-guest-status';

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

type TerminalStatus = 'expired' | 'consumed' | 'revoked' | 'unknown' | 'suspended';

const TERMINAL_STATUSES: readonly TerminalStatus[] = [
  'expired',
  'consumed',
  'revoked',
  'unknown',
  'suspended',
];

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

/** The small self-service resend form the plan corrects the issue's own
 * wording into — enumeration-safe, so it always shows the same "done"
 * copy regardless of what actually happened server-side. */
function ResendForm() {
  const { t } = useTranslation('auth');
  const regionConfig = useRegionConfig();
  const [identifier, setIdentifier] = React.useState('');
  const mutation = useMutation({
    mutationFn: () => {
      // Canonicalized (same as SignInForm/forgot-password's identifier
      // step) — ActivationService.resend only trims/lowercases and does
      // an exact match, so an uncanonicalized phone (+880, Bengali
      // digits) would silently no-op instead of resending. Falls back to
      // the raw trimmed value when it doesn't parse as either shape —
      // resend is enumeration-safe either way, so there's no valid input
      // this could wrongly reject.
      const detected = detectLoginIdentifier(identifier, regionConfig);
      const canonical =
        detected.kind === 'email'
          ? detected.email
          : detected.kind === 'phone'
            ? detected.phone
            : identifier.trim();
      return postAuthActivateResend(canonical);
    },
  });

  if (mutation.isSuccess) {
    return (
      <p role="status" className="text-text-secondary">
        {t('activate.resendDone')}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 border-t border-border-subtle pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <Label htmlFor="activate-resend-identifier">{t('activate.resendLabel')}</Label>
      <Input
        id="activate-resend-identifier"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        placeholder={t('identifier.placeholder')}
        autoComplete="username"
        disabled={mutation.isPending}
      />
      <Button
        type="submit"
        className="w-full"
        loading={mutation.isPending}
        disabled={!identifier.trim()}
      >
        {t('activate.resendAction')}
      </Button>
    </form>
  );
}

function ToSignInButton() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      className="w-full text-primary"
      onClick={() => void navigate({ to: '/login' })}
    >
      {t('toSignIn')}
    </Button>
  );
}

/** A link that cannot be used: each state offers the step that fits it. */
function TerminalCard({ status }: { status: TerminalStatus | 'missing' }) {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();

  if (status === 'consumed') {
    return (
      <GuestStatus icon={CircleCheck} tone="info" title={t('activate.consumed')}>
        <Button className="w-full" onClick={() => void navigate({ to: '/login' })}>
          {t('submit.action')}
        </Button>
        <Button
          variant="ghost"
          className="w-full text-primary"
          onClick={() => void navigate({ to: '/forgot-password' })}
        >
          {t('forgot.link')}
        </Button>
      </GuestStatus>
    );
  }

  if (status === 'suspended') {
    return (
      <GuestStatus
        icon={UserX}
        tone="danger"
        title={t('activate.suspended')}
        explanation={t('activate.suspendedExplanation')}
      >
        <ToSignInButton />
      </GuestStatus>
    );
  }

  return (
    <GuestStatus
      icon={Link2Off}
      tone="warning"
      title={status === 'missing' ? t('activate.missingToken') : t(`activate.${status}`)}
      explanation={t('activate.linkExplanation')}
    >
      <ResendForm />
      <ToSignInButton />
    </GuestStatus>
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
      <AuthLayout>
        <TerminalCard status="missing" />
      </AuthLayout>
    );
  }

  if (overrideStatus) {
    return (
      <AuthLayout>
        <TerminalCard status={overrideStatus} />
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
          <Skeleton className="h-10 w-full" />
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
        </GuestStatus>
      </AuthLayout>
    );
  }

  if (verifyQuery.data.status !== 'valid') {
    return (
      <AuthLayout>
        <TerminalCard status={verifyQuery.data.status} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <SetPasswordForm
        heading={t('activate.welcome', {
          name: verifyQuery.data.full_name,
          school: verifyQuery.data.school_name,
        })}
        subtext={t('activate.subtext')}
        onSubmit={(password) => mutation.mutate(password)}
        loading={mutation.isPending}
        error={buildActivateError(mutation.error, t)}
        submitLabel={t('setPassword.submit')}
      />
    </AuthLayout>
  );
}
