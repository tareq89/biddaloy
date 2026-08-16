import { I18nProvider } from '@biddaloy/ui/i18n';
import { enableMocking } from '@biddaloy/ui/mocks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routeTree.gen';
import './index.css';

// #8.9.2 owns the app's real QueryClient defaults (staleTime/gcTime/retry
// policy) — this stays the same bare default this file has always used
// until that ticket lands.
const queryClient = new QueryClient();

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
  // Lets TanStack Query's own `staleTime` (per query, tuned in [8.9.2])
  // decide freshness instead of the router's separate preload cache —
  // otherwise a preloaded-but-Query-stale result could still get served
  // from the router's cache for 30s past when Query would have refetched.
  defaultPreloadStaleTime: 0,
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
