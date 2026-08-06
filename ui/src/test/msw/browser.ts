/**
 * MSW's browser runtime — for running an SPA against mocks with no real
 * backend, and later for Storybook once [8.6.x] sets that up. Never
 * imported by `ui/src/test/setup.ts`: Vitest tests always run in Node or
 * jsdom, never a real browser with a Service Worker, so they use
 * `./server.ts`'s `setupServer` instead — importing this from a Vitest
 * setup file would fail outright (`setupWorker` needs `navigator.
 * serviceWorker`, which neither test environment provides).
 *
 * Deliberately not imported statically from any client app's `main.tsx` —
 * see `./enable-mocking.ts`'s own comment on why.
 */
import { ws, type WebSocketHandlerConnection } from 'msw';
import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

// A real browser has real WebSocket traffic that has nothing to do with
// this app's API — Vite's own HMR client, for one, which connects to the
// dev server over `ws://` and would otherwise get treated as an unhandled
// connection under `onUnhandledRequest: 'error'` in enable-mocking.ts,
// spamming the console and (had this passthrough not connected it)
// breaking HMR outright. `ws.link('*')` + `server.connect()` passes every
// WebSocket connection through to its real destination unless a more
// specific `ws.link(...)` handler claims it first. `onUnhandledRequest`
// only ever governs *HTTP* requests with no matching handler — it was
// never about WebSocket traffic, so this isn't working around that
// setting, it's just the thing that setting doesn't cover.
//
// Registered *after* `handlers`, not before: MSW matches handlers in
// array order and stops at the first match, so a wildcard listed first
// would swallow every WebSocket connection — including one a future,
// more specific `ws.link(...)` handler in `handlers` is meant to catch —
// before that handler ever runs. Last means "fallback for anything
// nothing more specific claimed," which is the actual intent here.
const wsPassthrough = ws
  .link('*')
  .addEventListener('connection', ({ server }: WebSocketHandlerConnection) => {
    server.connect();
  });

export const worker = setupWorker(...handlers, wsPassthrough);
