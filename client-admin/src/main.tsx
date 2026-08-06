import { enableMocking } from '@beton-boi/ui/mocks';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

// enableMocking() no-ops unless VITE_USE_MOCKS=true is set — see its own
// comment in ui/src/test/msw/browser.ts. Waiting on it before the first
// render, rather than starting the worker in parallel, avoids a request
// racing the service worker's registration and going to the real network
// instead of a mock.
void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
