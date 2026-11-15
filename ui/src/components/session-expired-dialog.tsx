/**
 * [3329 / 4293] When the session ends mid-work, ask for sign-in again in a
 * dialog instead of leaving the page, so what the user typed survives.
 *
 * Safety rules (D17, D18, Rule 25):
 * - The typed text survives only because the route stays mounted underneath,
 *   in React state. Nothing here writes it to localStorage or anywhere else.
 * - Nothing is replayed. After sign-in the dialog closes and the user presses
 *   Save again. Reads on the page are refetched; writes never are.
 * - Fail closed: the dialog only stays if the same person signs in to the same
 *   school again. A different user, a different school, a school choice, a
 *   support (login-as) session or an unknown previous identity all take the
 *   old exit: sign out and redirect to the sign-in page.
 *
 * The consuming app calls `openSessionExpiredDialog(redirect)` from its
 * `registerSessionExpiredHandler` and mounts `<SessionExpiredDialog />` once.
 */
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import {
  getAccessToken,
  getActiveTenant,
  isSupportSession,
  subscribeAuthState,
} from '../api/auth-state';
import { ApiError, RateLimitedError } from '../api/errors';
import { login, logout } from '../hooks/auth';
import { useTranslation } from '../i18n';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { SignInForm, type SignInCredentials, type SignInFormError } from './sign-in-form';

interface Identity {
  sub: string | null;
  tenant: string | null;
  support: boolean;
}

/** `sub` of a JWT, or null when it cannot be read. Read only, never verified:
 * the server already did that, this is a same-person check for the UI. */
function subOf(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** Who was signed in until the session ended. `notifySessionExpired()` clears
 * the auth state before the handler runs, so it is remembered as it changes. */
let lastIdentity: Identity | null = null;

function rememberIdentity(): void {
  const token = getAccessToken();
  if (!token) return;
  lastIdentity = { sub: subOf(token), tenant: getActiveTenant(), support: isSupportSession() };
}

let current: { redirect: () => void; identity: Identity } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the dialog, or runs `redirect` straight away when staying is not safe. */
export function openSessionExpiredDialog(redirect: () => void): void {
  if (current) return; // already asking; a second 401 must not stack or reset it
  const identity = lastIdentity;
  if (!identity?.sub || identity.support) {
    redirect();
    return;
  }
  current = { redirect, identity };
  emit();
}

function close(): void {
  current = null;
  emit();
}

function useCurrent() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

export interface SessionExpiredDialogViewProps {
  open: boolean;
  /** Called with the credentials; the host decides what a success means. */
  onSignIn: (credentials: SignInCredentials) => void;
  /** Esc or the close button: leave for the sign-in page. */
  onDismiss: () => void;
  loading?: boolean;
  error?: SignInFormError | null;
}

export function SessionExpiredDialogView({
  open,
  onSignIn,
  onDismiss,
  loading,
  error,
}: SessionExpiredDialogViewProps) {
  const { t } = useTranslation('states');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent size="sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('expired.title')}</DialogTitle>
          <DialogDescription>
            {t('expired.body')} {t('expired.kept')}
          </DialogDescription>
        </DialogHeader>
        <SignInForm
          headingLevel="h2"
          onSubmit={onSignIn}
          loading={loading ?? false}
          error={error ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Mount once. Renders nothing until the session ends; the translations load only then, inside
 * their own Suspense so the page underneath never blanks. */
export function SessionExpiredDialog() {
  const open = useCurrent();
  React.useEffect(() => {
    rememberIdentity();
    return subscribeAuthState(rememberIdentity);
  }, []);
  return open ? (
    <React.Suspense fallback={null}>
      <OpenDialog redirect={open.redirect} identity={open.identity} />
    </React.Suspense>
  ) : null;
}

function OpenDialog({ redirect, identity }: { redirect: () => void; identity: Identity }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('auth');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SignInFormError | null>(null);

  async function leave(): Promise<void> {
    await logout(queryClient);
    close();
    redirect();
  }

  async function signIn(credentials: SignInCredentials): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await login(queryClient, credentials);
      const [only] = result.memberships;
      const same =
        result.memberships.length === 1 &&
        only?.tenantId === identity.tenant &&
        subOf(result.access_token) === identity.sub;
      if (!same) return await leave();
      close();
      // Reads only. A write is never sent again for the user.
      void queryClient.refetchQueries({ type: 'active' });
    } catch (e) {
      setError({
        message:
          e instanceof RateLimitedError
            ? t('errors.rateLimitedGeneric')
            : e instanceof ApiError && e.statusCode === 401
              ? t('errors.invalidCredentials')
              : t('errors.generic'),
        tone: 'alert',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SessionExpiredDialogView
      open
      loading={busy}
      error={error}
      onSignIn={(c) => void signIn(c)}
      onDismiss={() => {
        close();
        redirect();
      }}
    />
  );
}
