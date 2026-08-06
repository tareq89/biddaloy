import { enableMocking } from '@beton-boi/ui/mocks';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

function renderApp(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
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
