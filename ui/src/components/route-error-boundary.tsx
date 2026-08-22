/**
 * [8.9.8]'s "a feature-route error renders a recoverable state without
 * killing navigation" AC. Wired as `createRouter`'s `defaultErrorComponent`
 * (`client-admin/src/main.tsx`) — TanStack Router gives every matched
 * route segment its own `CatchBoundary`, so an error thrown by one route's
 * `component`/`loader` replaces only that route's rendered output; the
 * shell around it (`__root.tsx`'s `AppShell`, its nav/`TenantBar`) is a
 * route boundary further up the tree and stays mounted.
 *
 * Reports to Sentry on mount via `captureRouteError` — route/tenant tags
 * are already current by then (`main.tsx`'s `subscribeAuthState`/
 * `router.subscribe('onResolved', ...)` keep them updated on every
 * navigation, before this ever renders), so this only needs to forward
 * the error itself.
 */
import { useNavigate, type ErrorComponentProps } from '@tanstack/react-router';
import * as React from 'react';

import { captureRouteError } from '../api/sentry';

import { ErrorState } from './error-state';

export interface RouteErrorFallbackProps extends ErrorComponentProps {
  message?: string;
  retryLabel?: string;
  homeLabel?: string;
}

export function RouteErrorFallback({
  error,
  reset,
  message = 'Something went wrong loading this page.',
  retryLabel = 'Try again',
  homeLabel = 'Go home',
}: RouteErrorFallbackProps) {
  const navigate = useNavigate();

  // Reported once per thrown error, not once per render — `reset()`
  // itself re-throws until the underlying cause is fixed, which would
  // otherwise double-report on every retry attempt.
  React.useEffect(() => {
    captureRouteError(error);
  }, [error]);

  return (
    <ErrorState
      message={message}
      onRetry={reset}
      retryLabel={retryLabel}
      onHome={() => void navigate({ to: '/' })}
      homeLabel={homeLabel}
    />
  );
}
