/**
 * `import('./browser')` is *dynamic* here on purpose, not a static import
 * of `worker` from `./browser.ts`. A static import would pull `msw` (and
 * its own dependencies, `@mswjs/interceptors`, `graphql`, ...) into every
 * production bundle regardless of whether `VITE_USE_MOCKS` is ever set —
 * confirmed by measurement: client-admin's bundle grew from ~245 KB to
 * ~525 KB gzipped-source when `worker` was a static import in `main.tsx`,
 * even though `enableMocking()` no-ops at runtime for every real deploy.
 * With the check first and the import second, Vite's build-time
 * `import.meta.env.VITE_USE_MOCKS` replacement turns the branch into dead
 * code when the flag isn't set at build time, and Rollup drops the whole
 * `import()` — and its `msw` dependency graph — from the production
 * bundle entirely, splitting it into its own chunk otherwise.
 */
export async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== 'true') {
    return;
  }
  const { worker } = await import('./browser');
  await worker.start({
    onUnhandledRequest: 'error',
    // Each client app is served under its own base path (`/admin/`,
    // `/student/`), and the worker script has to be fetched from wherever
    // Vite is actually serving `public/` from — a hardcoded root-relative
    // path would 404 under a non-root base.
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
