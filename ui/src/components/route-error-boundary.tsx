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
 *
 * [8.12.1] added the offline fork: a route that failed because the device
 * has no network renders `OfflineState` and reports nothing. Losing signal
 * on a train is not an application fault, and a Sentry issue per tunnel
 * would bury the real errors this boundary exists to surface.
 */
import { useNavigate, type ErrorComponentProps } from '@tanstack/react-router';
import * as React from 'react';

import { captureRouteError } from '../api/sentry';

import { ErrorState } from './error-state';
import { OfflineState } from './offline-state';

export interface RouteErrorFallbackProps extends ErrorComponentProps {
  message?: string;
  retryLabel?: string;
  homeLabel?: string;
  /** Offline copy, forwarded to `OfflineState`. Separate props from
   * `message` because the two states say different things and a caller
   * translating one must be able to translate the other. */
  offlineTitle?: string;
  offlineMessage?: string;
}

/**
 * Is this failure the network's fault rather than the app's?
 *
 * Classification is driven by the *error*, never by connectivity alone.
 * An earlier version returned `true` whenever `navigator.onLine === false`,
 * which quietly reclassified every genuine crash that happened to occur on
 * a phone in a lift: the user got "check your connection" and a retry that
 * could never work, and Sentry never heard about the bug.
 *
 * Three shapes count, and only one of them consults `navigator.onLine`:
 *
 *   - Axios reports an unreachable server as `code: 'ERR_NETWORK'` — no
 *     HTTP status, no response. Covers a down API and a captive-portal
 *     Wi-Fi that reports `onLine === true` while dropping every request.
 *   - `fetch()` rejects with a `TypeError` ("Failed to fetch"). Same
 *     meaning, different API.
 *   - A dynamic `import()` of a route chunk failed. This one is ambiguous
 *     on its own — it also happens when a deploy replaced the chunk the
 *     open tab is asking for, which is [8.12.2]'s update prompt, not an
 *     outage — so it counts as offline only when the OS also says there is
 *     no interface.
 *
 * A 500 from a reachable server has a `response` and a different `code`,
 * so it stays an error and is still reported. `unknown` in, boolean out:
 * an `errorComponent` receives whatever was thrown, which is not
 * guaranteed to be an `Error`.
 */
const CHUNK_LOAD_FAILURE =
  /failed to fetch dynamically imported module|importing a module script failed|loading chunk \S+ failed/i;

function isOfflineError(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === 'ERR_NETWORK') {
    return true;
  }

  const message = error instanceof Error ? error.message : '';

  if (error instanceof TypeError && /failed to fetch|networkerror/i.test(message)) {
    return true;
  }

  const offlineByOs = typeof navigator !== 'undefined' && navigator.onLine === false;
  return offlineByOs && CHUNK_LOAD_FAILURE.test(message);
}

export function RouteErrorFallback({
  error,
  reset,
  message = 'Something went wrong loading this page.',
  retryLabel = 'Try again',
  homeLabel = 'Go home',
  offlineTitle,
  offlineMessage,
}: RouteErrorFallbackProps) {
  const navigate = useNavigate();

  // Evaluated once per thrown error rather than on every render, so the
  // component cannot flip from offline to error styling mid-retry just
  // because connectivity blipped back while the failed output is still on
  // screen. `reset()` re-renders the route, which re-evaluates this.
  const offline = React.useMemo(() => isOfflineError(error), [error]);

  // Reported once per thrown error, not once per render — `reset()`
  // itself re-throws until the underlying cause is fixed, which would
  // otherwise double-report on every retry attempt.
  React.useEffect(() => {
    if (offline) return;
    captureRouteError(error);
  }, [error, offline]);

  const onHome = () => void navigate({ to: '/' });

  if (offline) {
    return (
      <OfflineState
        // Conditionally spread rather than passed as `undefined`: under
        // `exactOptionalPropertyTypes`, an explicit `undefined` is not the
        // same as an absent prop, and only an absent one lets
        // `OfflineState`'s own default copy apply.
        {...(offlineTitle !== undefined && { title: offlineTitle })}
        {...(offlineMessage !== undefined && { explanation: offlineMessage })}
        onRetry={reset}
        retryLabel={retryLabel}
        onHome={onHome}
        homeLabel={homeLabel}
      />
    );
  }

  return (
    <ErrorState
      message={message}
      onRetry={reset}
      retryLabel={retryLabel}
      onHome={onHome}
      homeLabel={homeLabel}
    />
  );
}
