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
 * has no network renders `RouteStatusState` and reports nothing. Losing signal
 * on a train is not an application fault, and a Sentry issue per tunnel
 * would bury the real errors this boundary exists to surface.
 *
 * [8.12.2] added the update fork, the other half of that same chunk-load
 * failure: online, the missing chunk means a deploy replaced this tab's
 * assets while it sat open. Stale code, not a crash — so it renders
 * "reload to update" and reports nothing either. Which of the three forks
 * runs is decided in `classifyRouteError` below.
 */
import { useNavigate, type ErrorComponentProps } from '@tanstack/react-router';
import { RefreshCw, WifiOff } from 'lucide-react';
import * as React from 'react';

import { captureRouteError } from '../api/sentry';

import { ErrorState } from './error-state';
import { RouteStatusState } from './route-status-state';

export interface RouteErrorFallbackProps extends ErrorComponentProps {
  message?: string;
  retryLabel?: string;
  homeLabel?: string;
  /** Offline copy, forwarded to `RouteStatusState`. Separate props from
   * `message` because the two states say different things and a caller
   * translating one must be able to translate the other. */
  offlineTitle?: string;
  offlineMessage?: string;
  /** [8.12.2] update-fork copy. Separate from `message` for the same
   * reason as the offline copy: a deploy-replaced chunk and a genuine
   * crash say different things. */
  updateTitle?: string;
  updateMessage?: string;
  updateRetryLabel?: string;
  /** How the update fork reloads onto the new version. Defaults to a
   * plain reload so `ui` stays app-agnostic; `client-admin` passes its
   * service-worker-aware `reloadForUpdate` (`src/pwa/register.ts`). */
  onReloadForUpdate?: () => void;
}

/**
 * Which failures are the network's or a deploy's fault rather than the
 * app's?
 *
 * Classification is driven by the *error*, never by connectivity alone.
 * An earlier version called it offline whenever `navigator.onLine ===
 * false`, which quietly reclassified every genuine crash that happened to
 * occur on a phone in a lift: the user got "check your connection" and a
 * retry that could never work, and Sentry never heard about the bug.
 *
 * Three shapes are special, and only one of them consults
 * `navigator.onLine`:
 *
 *   - Axios reports an unreachable server as `code: 'ERR_NETWORK'` — no
 *     HTTP status, no response. Covers a down API and a captive-portal
 *     Wi-Fi that reports `onLine === true` while dropping every request.
 *   - `fetch()` rejects with a `TypeError` ("Failed to fetch"). Same
 *     meaning, different API.
 *   - A dynamic `import()` of a route chunk failed. Ambiguous on its own:
 *     offline when the OS says there is no interface, otherwise a deploy
 *     replaced the chunk this open tab was asking for — [8.12.2]'s update
 *     fork.
 *
 * A 500 from a reachable server has a `response` and a different `code`,
 * so it stays an error and is still reported. `unknown` in: an
 * `errorComponent` receives whatever was thrown, which is not guaranteed
 * to be an `Error`.
 */
/**
 * A dynamic `import()` of a route chunk that never arrived. Every engine
 * words this differently, and — importantly — Chrome and Firefox both
 * throw a **`TypeError`** whose message also contains "fetch", so this
 * check has to run *before* the generic network-`TypeError` check below.
 * Getting that order wrong makes the update fork unreachable on Chrome:
 * a stale tab after a deploy reads as "you're offline" and offers a retry
 * that re-imports the same deleted chunk forever.
 *
 *   - Chrome/Edge: `TypeError: Failed to fetch dynamically imported module: …`
 *   - Firefox:     `TypeError: error loading dynamically imported module: …`
 *   - Safari:      `TypeError: Importing a module script failed.`
 *   - Bundler-era: `Loading chunk 42 failed.`
 */
const CHUNK_LOAD_FAILURE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk \S+ failed/i;

type RouteErrorKind = 'offline' | 'update' | 'error';

function classifyRouteError(error: unknown): RouteErrorKind {
  if ((error as { code?: unknown } | null)?.code === 'ERR_NETWORK') {
    return 'offline';
  }

  const message = error instanceof Error ? error.message : '';

  // Before the generic `TypeError` check, not after — see the comment on
  // `CHUNK_LOAD_FAILURE`. A missing chunk is the more specific diagnosis
  // and its message satisfies both patterns.
  if (CHUNK_LOAD_FAILURE.test(message)) {
    const offlineByOs = typeof navigator !== 'undefined' && navigator.onLine === false;
    return offlineByOs ? 'offline' : 'update';
  }

  if (error instanceof TypeError && /failed to fetch|networkerror/i.test(message)) {
    return 'offline';
  }

  return 'error';
}

export function RouteErrorFallback({
  error,
  reset,
  message = 'Something went wrong loading this page.',
  retryLabel = 'Try again',
  homeLabel = 'Go home',
  offlineTitle = "You're offline",
  offlineMessage = 'This page needs a connection to load. Check your network and try again — anything already loaded is still available.',
  updateTitle = 'A newer version is available',
  updateMessage = 'This page is from an older version of the app. Reload to pick up the new one — anything you have already saved is safe.',
  updateRetryLabel = 'Reload to update',
  onReloadForUpdate = () => window.location.reload(),
}: RouteErrorFallbackProps) {
  const navigate = useNavigate();

  // Evaluated once per thrown error rather than on every render, so the
  // component cannot flip from offline to error styling mid-retry just
  // because connectivity blipped back while the failed output is still on
  // screen. `reset()` re-renders the route, which re-evaluates this.
  const kind = React.useMemo(() => classifyRouteError(error), [error]);

  // Reported once per thrown error, not once per render — `reset()`
  // itself re-throws until the underlying cause is fixed, which would
  // otherwise double-report on every retry attempt.
  React.useEffect(() => {
    // Neither the offline fork nor the update fork is an application
    // fault, and one Sentry issue per tunnel or per deploy would bury the
    // real errors this boundary exists to surface. #186 can revisit
    // whether a genuine CDN outage deserves its own signal.
    if (kind !== 'error') return;
    captureRouteError(error);
  }, [error, kind]);

  const onHome = () => void navigate({ to: '/' });

  // Both non-fault states render through `RouteStatusState`, not
  // `ErrorState`: neither is the app's fault, so neither should announce
  // assertively or wear the "something broke" styling. The update fork
  // used `ErrorState` briefly, which meant a routine deploy interrupted a
  // screen-reader user mid-form and left the route with no `<h1>`.
  if (kind === 'update') {
    return (
      <RouteStatusState
        title={updateTitle}
        explanation={updateMessage}
        onRetry={onReloadForUpdate}
        retryLabel={updateRetryLabel}
        onHome={onHome}
        homeLabel={homeLabel}
        icon={<RefreshCw aria-hidden="true" />}
      />
    );
  }

  if (kind === 'offline') {
    return (
      <RouteStatusState
        title={offlineTitle}
        explanation={offlineMessage}
        onRetry={reset}
        retryLabel={retryLabel}
        onHome={onHome}
        homeLabel={homeLabel}
        icon={<WifiOff aria-hidden="true" />}
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
