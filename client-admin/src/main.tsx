import {
  createAppQueryClient,
  getActiveTenant,
  initSentry,
  registerSessionExpiredHandler,
  subscribeAuthState,
  updateSentryRouteTag,
  updateSentryTenantTag,
} from '@biddaloy/ui/api';
import { RouteErrorFallback, Toaster } from '@biddaloy/ui/components';
import { I18nProvider } from '@biddaloy/ui/i18n';
import { enableMocking } from '@biddaloy/ui/mocks';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider, type ErrorComponentProps } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { registerServiceWorker, reloadForUpdate } from './pwa/register';
import { routeTree } from './routeTree.gen';
import './index.css';

// [8.9.8]: no-ops without `VITE_SENTRY_DSN` set (local dev, CI, a preview
// build without one wired up yet) — see `initSentry`'s own comment
// (`ui/src/api/sentry.ts`).
initSentry({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE });

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
  return <RouteErrorFallback {...props} onReloadForUpdate={reloadForUpdate} />;
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
