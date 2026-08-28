import { defineConfig, devices } from '@playwright/test';

/**
 * [8.12.6] The PWA/offline suite's own Playwright config — separate from
 * `playwright.config.ts` for one non-negotiable reason:
 *
 * ```text
 *   playwright.config.ts  →  yarn dev:client-admin  →  vite dev
 *                            devOptions.enabled: false  →  NO service worker
 *
 *   this file             →  yarn build:client-admin  →  vite preview
 *                            real dist/sw.js          →  the thing under test
 * ```
 *
 * `client-admin/vite.config.ts` disables the service worker in `vite dev`
 * on purpose (a dev-server SW caches unhashed module URLs and makes every
 * later edit look like it did not apply). So the existing e2e stack can
 * never see a service worker, and a suite about service workers has to
 * build and preview production output instead. `vite preview` inherits
 * `server.proxy`, so `/api` still reaches the API on :3000 exactly as the
 * dev server does — the same setup CI's Lighthouse job already uses.
 *
 * Port 5175, not 5174, so this can run next to a developer's own
 * `yarn dev:client-admin` without either fighting for the port.
 *
 * ## Rules for anything added to `e2e/pwa/`
 *
 * 1. **`context.setOffline()` is the only honest offline lever.** In the
 *    pinned Playwright (1.62.1) it is applied to service-worker targets
 *    too (`crBrowser.ts` calls `sw.updateOffline()` for every attached
 *    `CRServiceWorker`), and it flips `navigator.onLine` and fires
 *    `online`/`offline`, which is what `startQueueReplay` and `useOnline`
 *    listen to.
 * 2. **Never fake offline with `context.route()`.** Route interception
 *    does not see service-worker-originated fetches, so a "test" built
 *    that way passes while the SW quietly serves everything from cache —
 *    it proves nothing and hides regressions.
 * 3. **Never set `serviceWorkers: 'block'`** (or
 *    `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK`). Both silently switch
 *    off the exact machinery this suite exists to exercise.
 */
const CI = !!process.env.CI;

const PWA_BASE_URL = 'http://localhost:5175';

// `e2e/fixtures/test.ts` builds its login/storage-state against
// `shells.app.baseURL` (`e2e/config.ts`). Pointing that at this suite's
// port here — before the config's own import of it is evaluated by the
// spec files — lets `loggedIn()` work unmodified, instead of forking the
// fixture for one suite.
process.env.E2E_BASE_URL = `${PWA_BASE_URL}/`;

export default defineConfig({
  testDir: './e2e/pwa',
  // Serial, single worker, deliberately: `update-flow.spec.ts` rewrites
  // the shared `dist/sw.js` that every other spec's preview server is
  // serving, and there is exactly one `dist/` for the whole run.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['html', { open: 'never', outputFolder: 'playwright-report-pwa' }], ['list']]
    : [['html', { open: 'on-failure', outputFolder: 'playwright-report-pwa' }]],
  outputDir: 'test-results-pwa',
  timeout: 90_000,
  use: {
    baseURL: PWA_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Chromium only. Offline emulation reaching service workers is verified
  // in Chromium's CDP path, and the CI matrix is chromium-only anyway
  // (#148). No `setup` project: `loggedIn()` logs in per test over the
  // API, and the shared storageState files the main suite's setup writes
  // are keyed to the other port.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'yarn dev:server',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { NODE_ENV: 'test' },
    },
    {
      // The build is the point — `vite preview` serves whatever is in
      // `dist/`, so without building first this suite would test a stale
      // (or missing) service worker. ~2-4 min in CI, accepted: a PWA
      // suite that only ran post-merge would not have caught the class of
      // bug #184 found (a replay engine nothing ever started).
      command:
        'yarn build:client-admin && yarn workspace @biddaloy/client-admin preview --port 5175 --strictPort',
      url: `${PWA_BASE_URL}/`,
      reuseExistingServer: !CI,
      timeout: 300_000,
    },
  ],
});
