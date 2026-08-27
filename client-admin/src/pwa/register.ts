/**
 * [8.12.1]'s service-worker registration, called once from `main.tsx`.
 *
 * `virtual:pwa-register` is a module `vite-plugin-pwa` synthesises at
 * build time; the types come from the `vite-plugin-pwa/client` reference
 * in `src/vite-env.d.ts`.
 */
export function registerServiceWorker(): void {
  // MSW owns a root-scope service worker whenever mocks are on
  // (`ui/src/test/msw/enable-mocking.ts` starts it for
  // `VITE_USE_MOCKS=true`). Two workers at the same scope means the last
  // registration wins, so a mock run would either lose its request
  // interception or lose the PWA — neither silently-broken state is worth
  // having. Mock mode never needs offline support, so the PWA yields.
  //
  // Written against `import.meta.env` directly so Vite's build-time
  // replacement turns this into `if (false)` for real builds and Rollup
  // drops `workbox-window` from the bundle when mocks *are* on.
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    return;
  }

  // Dynamically imported, not a static import: `virtual:pwa-register`
  // pulls in `workbox-window` (~4 KB gzipped), and registration is not on
  // the path to first paint. A static import puts that weight in the
  // entry chunk, which sits against a hard 225 KB gzip ceiling
  // (`scripts/check-route-chunks.mjs`) — this build actually crossed it.
  // As its own chunk it loads in parallel with the first render instead.
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      // Deliberately empty, with `registerType: 'prompt'` in
      // `vite.config.ts`. Auto-reloading the page the moment a deploy
      // lands would discard a half-typed fee adjustment without asking;
      // the explicit "Update available — reload?" affordance is
      // [8.12.2]'s whole job, and it will send `SKIP_WAITING` (handled in
      // `src/sw.ts`) from here. Until then a new version activates when
      // every tab of the app has closed — the standard, safe default.
      onNeedRefresh() {},
    });
  });
}
