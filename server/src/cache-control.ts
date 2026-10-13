import { basename } from 'path';

import type { NextFunction, Request, Response } from 'express';

/**
 * Cache headers set in one place so a CDN "Cache Everything" rule can never
 * store one person's data and hand it to another ([75.20]).
 *
 * - `/api/*` gets `no-store` before the handler runs. A route that sets its
 *   own `Cache-Control` (`@Header(...)` or `res.setHeader`) replaces it, so
 *   the ICS feed and the immutable asset routes keep their values.
 * - The SPA shell (`index.html`, `sw.js`) is `no-cache`: always revalidated,
 *   never stale after a deploy. Hashed `/assets/*` files are left alone.
 *
 * No `Vary: Authorization`: the PWA's API cache would miss on every token
 * refresh, and `no-store` already keeps shared caches out.
 */
export function apiNoStoreByDefault(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** `setHeaders` hook for `express.static`. */
export function setStaticCacheHeaders(res: Response, filePath: string): void {
  const name = basename(filePath);
  if (name === 'index.html' || name === 'sw.js') {
    res.setHeader('Cache-Control', 'no-cache');
  }
}
