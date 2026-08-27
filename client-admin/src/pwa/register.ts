/**
 * [8.12.1]'s service-worker registration, called once from `main.tsx`,
 * plus [8.12.2]'s update prompt on top of it.
 *
 * `virtual:pwa-register` is a module `vite-plugin-pwa` synthesises at
 * build time; the types come from the `vite-plugin-pwa/client` reference
 * in `src/vite-env.d.ts`.
 *
 * The update flow, end to end:
 *
 * ```
 * deploy lands ──▶ new sw.js installs, waits
 *        │
 *        ├─ tab A: onNeedRefresh ──▶ toast "New version available — Reload"
 *        │            user clicks ──▶ accepted = true; updateSW()
 *        │                             (posts SKIP_WAITING; does NOT reload)
 *        │
 *        └─ new worker activates, clientsClaim() takes over every tab
 *                     │
 *                     ├─ tab A: onNeedReload, accepted ──▶ location.reload()
 *                     └─ tab B: onNeedReload, not accepted ──▶ toast
 *                                "updated — reload when you're ready"
 * ```
 *
 * Two things this file deliberately does *not* do, because both are how
 * PWA update loops get built:
 *
 *   - It never posts `SKIP_WAITING` itself. `updateSW()` (the handle
 *     `registerSW` returns) already does, via workbox-window's
 *     `messageSkipWaiting()`.
 *   - It never adds a `controllerchange` listener. The plugin owns exactly
 *     one reload trigger — the `controlling` event, surfaced here as
 *     `onNeedReload` — and duplicating it means two reloads racing.
 *
 * `onNeedReload` overrides the plugin's default, which is to reload *every*
 * controlled tab the instant any one of them accepts. That default would
 * throw away a half-typed fee adjustment in a tab whose user never asked
 * for anything, so it is replaced with a prompt in the tabs that did not
 * accept.
 */
import { showUpdatePrompt, showUpdatedElsewherePrompt } from './update-prompt';

/** How often a long-open tab re-checks for a deploy. Browsers only fetch
 * `sw.js` again on navigation, and a fee desk can sit on one route all
 * day — without this poll, "there is a new version" would never fire for
 * exactly the users who most need to hear it. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Set only when *this* tab's user clicked Reload. Read back in
 * `onNeedReload` to tell "I asked for this" apart from "another tab
 * asked".
 *
 * Cleared by the watchdog below if the acceptance does not produce an
 * activation. Left latched, it would make a *later* deploy — accepted in
 * some other tab — force-reload this tab without asking, which is the
 * "discards a half-typed fee adjustment" failure this whole flow exists
 * to prevent. */
let accepted = false;

/** How long to wait for the new worker to take control after accepting
 * before giving up and reloading anyway. `messageSkipWaiting()` silently
 * does nothing when no worker is waiting, so without this the user's
 * click can vanish into no feedback at all. */
const ACTIVATION_TIMEOUT_MS = 5000;

/**
 * The accept path, shared by the toast's action and the route error
 * boundary's reload affordance. Asks the waiting worker to activate and
 * lets `onNeedReload` do the reloading — but never leaves the user
 * stranded if that never arrives.
 */
function acceptUpdate(): void {
  accepted = true;

  const watchdog = setTimeout(() => {
    // No `controlling` event within the timeout: either nothing was
    // waiting, or activation failed. Reload regardless — the user asked
    // to be on the new version, and a button that does nothing is worse
    // than a reload that turns out to be redundant.
    accepted = false;
    window.location.reload();
  }, ACTIVATION_TIMEOUT_MS);

  void Promise.resolve(updateSW?.())
    .then(() => {
      // Deliberately does not clear the watchdog on success: `updateSW()`
      // resolves once the message is posted, not once the new worker is
      // in control, so the reload is still owed by `onNeedReload`.
    })
    .catch(() => {
      clearTimeout(watchdog);
      accepted = false;
      window.location.reload();
    });
}

/** The handle `registerSW` returns, kept so the route error boundary's
 * reload affordance (`reloadForUpdate`) can drive the same accept path.
 * `undefined` until the dynamic import resolves, and under mocks forever. */
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

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
  // entry chunk, which sits against a hard gzip ceiling
  // (`ENTRY_CHUNK_GZIP_CEILING_BYTES` in
  // `scripts/check-route-chunks.mjs`) — this build actually crossed it.
  // As its own chunk it loads in parallel with the first render instead.
  // `.catch` rather than a bare `void`: when a deploy has already
  // replaced this tab's chunks — precisely the case this module exists to
  // handle — the import itself rejects. Swallowed because there is no
  // recovery beyond running without a service worker, which is exactly
  // what happens.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      updateSW = registerSW({
        immediate: true,
        // A new worker is installed and waiting. `registerType: 'prompt'`
        // (`vite.config.ts`) means nothing happens until the user says so.
        onNeedRefresh() {
          showUpdatePrompt(acceptUpdate);
        },
        // The new worker has taken control of this tab.
        onNeedReload() {
          if (accepted) {
            window.location.reload();
            return;
          }
          showUpdatedElsewherePrompt(() => {
            window.location.reload();
          });
        },
        onRegisteredSW(_swScriptUrl, registration) {
          if (!registration) return;
          // Never cleared: its only natural end is the tab closing, and a
          // timer id nothing reads would just be dead weight.
          setInterval(() => {
            // Skipped while offline: `registration.update()` would just
            // fail, and a failed update check is noise, not information.
            if (!navigator.onLine) return;
            // Caught, not `void`-ed: a 5xx or an aborted `sw.js` re-fetch
            // would otherwise surface as an `unhandledrejection`, which
            // [8.12.7]'s Sentry handler reports — once an hour, per open
            // tab, for a condition nobody can act on.
            registration.update().catch(() => {});
          }, UPDATE_CHECK_INTERVAL_MS);
        },
      });
    })
    .catch(() => {});
}

/**
 * The reload affordance behind a "this page is from an older version"
 * error state (`RouteErrorFallback`'s update fork) — the tab is running
 * code whose lazy chunks a deploy has already deleted.
 *
 * Prefers the clean path (tell the waiting worker to activate, then let
 * `onNeedReload` reload) but falls back to a plain reload, because
 * workbox's `messageSkipWaiting()` silently does nothing when no worker is
 * waiting. Without the fallback the button would be a dead end in the
 * common case where the new worker already activated.
 */
export function reloadForUpdate(): void {
  void (async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting && updateSW) {
      acceptUpdate();
      return;
    }
    window.location.reload();
  })().catch(() => {
    // `getRegistration()` can reject outright (storage disabled, an
    // insecure context). This button is the user's only exit from a stale
    // tab, so a rejection must still reload rather than silently do
    // nothing and log an unhandled rejection.
    window.location.reload();
  });
}
