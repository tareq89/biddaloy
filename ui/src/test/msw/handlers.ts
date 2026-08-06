import type { HttpHandler } from 'msw';

/**
 * The shared handler library — populated by [8.4.2]'s typed request
 * handlers, one per API endpoint. Empty for now: this issue only builds
 * the MSW plumbing (server/worker setup, lifecycle, unhandled-request
 * guard), not the handlers themselves.
 */
export const handlers: HttpHandler[] = [];
