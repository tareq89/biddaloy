import {
  createAppQueryClient,
  getActiveTenant,
  initSentry,
  registerSessionExpiredHandler,
  startQueueReplay,
  subscribeAuthState,
  updateSentryRouteTag,
  updateSentryTenantTag,
} from '@biddaloy/ui/api';
import { RouteErrorFallback, RoutePending, Toaster } from '@biddaloy/ui/components';
import { I18nProvider, useTranslation } from '@biddaloy/ui/i18n';
import { enableMocking } from '@biddaloy/ui/mocks';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider, type ErrorComponentProps } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { registerServiceWorker, reloadForUpdate } from './pwa/register';
import { routeTree } from './routeTree.gen';
import './index.css';

// [8.9.2]'s app-wide QueryClient — cache-first staleTime/gcTime, a retry
// policy that excludes 4xx, and the global 401/403 error handling. See
// `@biddaloy/ui/api`'s `createAppQueryClient` for the tuned values and why
// each one is set the way it is.
const queryClient = createAppQueryClient();

// [8.12.2]: the boundary's "this page is from an older version" fork
// reloads through the service-worker-aware `reloadForUpdate` (it lets a
// waiting worker activate first) instead of `ui`'s app-agnostic plain
// `location.reload()` default. A named wrapper rather than an inline
// arrow so the component identity is stable across renders.
function RouteErrorFallbackWithUpdate(props: ErrorComponentProps) {
  // [8.12.6]: the copy is passed translated. `@biddaloy/ui` stays
  // translation-agnostic and defaults its strings to English, which meant
  // this Bangla-default app rendered "You're offline" in English on the
  // one screen a user sees precisely when nothing else is working.
  //
  // [8.14.5]: `useTranslation('common')`, not the bare `useTranslation()`
  // this used to be — behaviourally identical (`common` is `i18n.ts`'s own
  // `defaultNS`), but `check-i18n-keys.mjs` resolves a file's default
  // namespace from the *first* `useTranslation(...)` call with a quoted
  // string argument; a bare call doesn't match that pattern at all, so it
  // was silently skipped in favour of `RoutePendingFallback`'s
  // `useTranslation('nav')` further down, misattributing every key below
  // to the wrong namespace.
  const { t } = useTranslation('common');
  return (
    <RouteErrorFallback
      {...props}
      onReloadForUpdate={reloadForUpdate}
      offlineTitle={t('offline.pageTitle')}
      offlineMessage={t('offline.pageExplanation')}
      updateTitle={t('update.pageTitle')}
      updateMessage={t('update.pageExplanation')}
      updateRetryLabel={t('update.reload')}
      retryLabel={t('offline.retry')}
    />
  );
}

// [8.14.5]: router-wide `defaultPendingComponent` — before this, a route
// with no loader (or a loader still in flight past `defaultPendingMs`)
// rendered `null` inside `<main>` while pending, which is the "blank
// content area" flash this ticket exists to kill. A named component, not
// an inline arrow, for the same stable-identity reason
// `RouteErrorFallbackWithUpdate` above already documents. `variant="form"`
// is the generic middle ground: it doesn't visually promise a table
// (`list`) or a single record's fields (`detail`) when the router doesn't
// know which route it's covering for — routes with a more specific shape
// override this with their own `pendingComponent` (see `route-loaders.ts`).
function RoutePendingFallback() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

// `basepath` matches `vite.config.ts`'s `base: '/admin/'` — without it,
// the router would try to match against `/students` instead of
// `/admin/students`, and every link/redirect would be wrong under the
// server's production static-file mounting (see `server/src/main.ts`).
const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  // [8.9.1]'s "hovering a sidebar link prefetches the route and data" AC.
  defaultPreload: 'intent',
  // Lets TanStack Query's own `staleTime` (30s, set by [8.9.2]'s
  // `createAppQueryClient`) decide freshness instead of the router's
  // separate preload cache — otherwise a preloaded-but-Query-stale result
  // could still get served from the router's cache for 30s past when
  // Query would have refetched.
  defaultPreloadStaleTime: 0,
  // [8.9.8]'s "a feature-route error renders a recoverable state without
  // killing navigation" AC — every matched route segment gets its own
  // `CatchBoundary` (TanStack Router's own mechanism), falling back to
  // this when a route doesn't set its own `errorComponent`. The sidebar/
  // header chrome (`__root.tsx`'s `AppShell`) lives above the `<Outlet />`
  // this replaces, so it stays up around the failure.
  defaultErrorComponent: RouteErrorFallbackWithUpdate,
  // [8.14.5]: router-wide pending fallback — see `RoutePendingFallback`'s
  // own comment above for why `null` was the problem.
  defaultPendingComponent: RoutePendingFallback,
  // Was 1000ms default: a loader resolving just past this shows nothing
  // at all — no flash on cached/preloaded routes, which
  // `defaultPreload: 'intent'` above makes the common case. Anything
  // slower now shows the pending UI within ~200ms (AC 2), not TanStack
  // Router's original 1s hold.
  defaultPendingMs: 200,
  // Was 500ms default: once the pending UI is shown, it now stays up for
  // at least 200ms rather than 500ms — kills the "500ms dead hold" AC 2
  // calls out, while still being long enough not to strobe on a loader
  // that resolves moments after the 200ms `defaultPendingMs` threshold.
  defaultPendingMinMs: 200,
  // [8.14.5]: cross-fades `#main-content` between routes — see
  // `globals.css`'s `view-transition-name` block for the scoping that
  // keeps this from touching the header/sidebar chrome, and
  // `useRouteFocus`'s `waitForViewTransition` call for why focus now
  // waits on this before moving.
  defaultViewTransition: true,
});

// [8.9.8]: no-ops without `VITE_SENTRY_DSN` set (local dev, CI, a preview
// build without one wired up yet) — see `initSentry`'s own comment
// (`ui/src/api/sentry.ts`).
//
// [8.12.7]: `router` is what turns on browser tracing, which is what
// collects real-user LCP/CLS/INP and names each transaction after the
// route id. That is why this call now sits *below* `createRouter` rather
// than at the top of the module: the integration instruments this exact
// instance. The cost is that a throw inside `createRouter` itself goes
// unreported — the same exposure every line above it already had.
//
// `VITE_SENTRY_TRACES_SAMPLE_RATE` is left `undefined` when unset (rather
// than defaulted here) so `initSentry` owns the single default, and an
// out-of-range or non-numeric value falls back to it too.
initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  router,
  ...(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE !== undefined && {
    tracesSampleRate: Number.parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE),
  }),
});

// [8.9.8]: opaque tenant id only, kept current across a mid-session
// switch — see `updateSentryTenantTag`'s own comment
// (`ui/src/api/sentry.ts`). Registered once here rather than in `ui`
// itself, same reasoning as `registerSessionExpiredHandler` below: this
// package stays app-agnostic.
subscribeAuthState(() => updateSentryTenantTag(getActiveTenant()));

// [8.9.8]: the route's static id (e.g. `/students/$studentId`), never the
// resolved pathname — see `updateSentryRouteTag`'s own comment, which
// also owns the "no matched route yet" fallback so this call site never
// needs to reach for a pathname itself. `onResolved` fires once
// `router.state.matches` reflects the new location, so the deepest
// match's `routeId` is always the just-navigated-to route. `router` isn't
// a reusable `ui` concern (each consuming app has its own instance), so
// this lives here rather than in `ui/src/api/sentry.ts`.
router.subscribe('onResolved', () => {
  updateSentryRouteTag(router.state.matches.at(-1)?.routeId);
});

// [8.9.3]'s "failure routes to login, no redirect loop" — this fires from
// deep inside `apiClient`'s response interceptor (`ui/src/api/client.ts`)
// after a mid-session refresh genuinely fails, not from `__root.tsx`'s own
// `beforeLoad` guard (the *cold-load* half of the same AC). Both converge
// on `/login`, and both skip re-redirecting when already there, so neither
// path can loop into the other.
registerSessionExpiredHandler(() => {
  const { pathname, href } = router.state.location;
  if (pathname !== '/login') {
    void router.navigate({ to: '/login', search: { redirect: href }, replace: true });
  }
});

// Registers this app's concrete route tree against `@tanstack/react-
// router`'s ambient types — every `<Link to="...">`, `useParams()`, etc.
// across the app is checked against these exact routes from here on.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function renderApp(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <RouterProvider router={router} />
          <Toaster />
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

// enableMocking() no-ops unless VITE_USE_MOCKS=true is set — see its own
// comment in ui/src/test/msw/browser.ts. Waiting on it before the first
// render, rather than starting the worker in parallel, avoids a request
// racing the service worker's registration and going to the real network
// instead of a mock. The .catch() matters: worker.start() can reject for
// reasons that have nothing to do with this app (an insecure context, a
// browser blocking service workers, mockServiceWorker.js 404ing under the
// configured base path) — without it, a rejection here would silently
// skip renderApp() entirely and leave a blank page instead of falling
// back to rendering without mocks.
void enableMocking()
  .catch((error: unknown) => {
    console.error('[enableMocking] failed to start the mock worker — continuing without it', error);
  })
  .then(renderApp);

// [8.12.1]: kicked off alongside the render, not awaited before it —
// registration is not on the critical path to pixels, and keeping it out
// of the promise chain above means a service-worker failure can never
// block the app from mounting. No-ops under `VITE_USE_MOCKS=true` so it
// can't race `enableMocking`'s worker for the root scope — see its own
// comment in `pwa/register.ts`.
registerServiceWorker();

// [8.12.5]: the offline mutation queue's replay listeners. #183 made
// registration explicit rather than an import side effect, which left the
// call itself to the consuming app — without this line `replayQueue` is
// only ever reached by a direct "Send now"/"Try again" click, and rows
// queued in a previous session would sit unsent forever. Kicked off
// alongside the render for the same reason `registerServiceWorker()` is:
// it is not on the critical path to pixels. Idempotent (`started` latch),
// and the auth-state subscription it installs lives as long as the tab, so
// there is nothing for this module to tear down — `stopQueueReplay()`
// exists for tests, which is where module state actually needs resetting.
startQueueReplay();
