import { I18nProvider } from '@beton-boi/ui/i18n';
import { enableMocking } from '@beton-boi/ui/mocks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

// #8.7.13 is this app's first real screen — it needs both TanStack Query
// (its data hooks) and i18next (every string on it is translated), so
// this is also the first place either provider gets wired into a real
// entry point rather than just `renderWithProviders`'s test stack. See
// `App.tsx`'s own comment for why this still isn't a router/nav shell.
const queryClient = new QueryClient();

function renderApp(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <App />
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
