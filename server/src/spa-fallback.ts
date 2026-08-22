import { join } from 'path';

import type { Request, Response, NextFunction } from 'express';

/**
 * The production SPA fallback: a URL the client's router owns
 * (`/students/42`) has no file on disk, so it gets `index.html` and the
 * router resolves it in the browser.
 *
 * Extracted from `main.ts`'s `bootstrap()` for the same reason
 * `cors-origins.ts` and `security-headers.ts` were — the rules below are
 * the interesting part and booting a whole Nest app is a poor way to test
 * three `if`s.
 *
 * Three rules, all of them fixing something [8.9.10] found:
 *
 * 1. **`GET`/`HEAD` only.** A `POST` to an unknown path isn't a
 *    navigation. Answering it with `index.html` turned a 404 into a 200
 *    full of HTML, which is what `POST /admin/x` used to do.
 * 2. **An unreadable file is a 404, not a 500.** `res.sendFile` without a
 *    callback throws ENOENT out of the response stream, and Express turns
 *    that into a 500. That was the old `GET /teacher/*` behaviour: the
 *    per-client loop registered `/teacher` even though `client-teacher`
 *    never existed, so every request under it hit a missing file. Passing
 *    `next` on error lets the request fall through to a plain 404.
 * 3. **`/assets/*` is a real 404, not `index.html`.** `main.ts` mounts this
 *    after `express.static(clientDist)`, so a request only reaches here
 *    once static has already looked for the file and not found it. For a
 *    navigation that's expected (no static file matches `/students/42`),
 *    but Vite's build puts every hashed JS/CSS bundle under `/assets/`
 *    (`assetsDir`'s default) — a missing one is a broken deploy, and
 *    answering it with `index.html` would hide that behind a silent 200.
 *
 * `/api` is excluded for the same reason: an unmatched API path is a real
 * 404 from the API — a client asking for JSON should never be handed a page.
 */
export function buildSpaFallback(clientDistPath: string) {
  const indexHtmlPath = join(clientDistPath, 'index.html');

  return function spaFallback(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (req.path.startsWith('/assets/')) {
      next();
      return;
    }
    res.sendFile(indexHtmlPath, (error?: Error) => {
      if (error) next();
    });
  };
}
