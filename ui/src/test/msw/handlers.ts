import type { HttpHandler } from 'msw';

/**
 * The shared handler library — populated by [8.4.2]'s typed request
 * handlers, one per API endpoint. Empty for now: this issue only builds
 * the MSW plumbing (server/worker setup, lifecycle, unhandled-request
 * guard), not the handlers themselves.
 *
 * `readonly`: the intended way to add or override a handler is
 * `server.use(...)` (per-test, auto-reset) or editing this file (the
 * shared baseline) — not mutating this array in place, which nothing
 * calling `setupServer`/`setupWorker` would ever see take effect anyway,
 * since both capture the handlers at construction time.
 */
export const handlers: readonly HttpHandler[] = [];
