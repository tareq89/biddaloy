import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * E2E harness — `e2e/` isn't a yarn workspace (it drives the API and the
 * client together, not one package from inside it), same reasoning as the
 * root `vitest.config.ts` covering multiple frontend packages from a single
 * top-level config.
 *
 * `webServer` boots the real API (`dev:server`) plus the client dev server,
 * the same processes `yarn dev:*` start for a human — not a separate
 * CI-only build path. Locally that means: bring up Postgres/Redis with
 * `docker compose up -d db redis` (see README's Development section),
 * migrate + seed once, then `yarn e2e` reuses that stack via
 * `reuseExistingServer`. CI has no persistent stack, so it migrates, seeds,
 * and lets Playwright start and tear down both servers itself.
 */
const CI = !!process.env.CI;

// [15.1] Set only by ci.yml's per-job collect step. Unset (every local run)
// means zero behaviour change — the array below is unchanged.
const timingsOut = process.env.CI_TIMINGS_OUT;
const timingsReporter: ReporterDescription[] = timingsOut
  ? [['json', { outputFile: timingsOut }]]
  : [];

// Annotated as ReporterDescription[] rather than spread inline: Playwright
// types `reporter` as a union of literal tuples, and spreading a ternary
// into a fresh array literal widens `['list']` to `(string | {...})[]`,
// which no longer satisfies the required 1-or-2-element tuple shape.
const baseReporter: ReporterDescription[] = CI
  ? [['html', { open: 'never' }], ['list']]
  : [['html', { open: 'on-failure' }]];

// Browsers come from E2E_BROWSERS (comma-separated: "chromium,firefox,webkit").
// Default is chromium only — a deliberate product decision (#148): widening
// the list is an env-variable change (repo CI variable E2E_BROWSERS_JSON in
// the workflow, E2E_BROWSERS locally), never a code edit. Device presets for
// non-default browsers stay mapped so enabling one later needs no config work.
const BROWSER_DEVICES = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const browsers = (process.env.E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((b) => b.trim())
  .filter((b): b is keyof typeof BROWSER_DEVICES => Object.hasOwn(BROWSER_DEVICES, b));

export default defineConfig({
  testDir: './e2e',
  // [8.12.6]'s PWA suite is excluded here and run by
  // `playwright.pwa.config.ts` (`yarn e2e:pwa`) instead. It needs a
  // *production* build served by `vite preview`, because the dev server
  // this config points at has no service worker at all
  // (`devOptions.enabled: false` in `client-admin/vite.config.ts`).
  // Without this ignore, `testDir: './e2e'` globs those specs too and
  // runs every one of them against a stack that cannot satisfy them.
  testIgnore: '**/pwa/**',
  fullyParallel: true,
  forbidOnly: CI,
  // A suite needing more than one CI retry is hiding flake — see
  // [8.5.1]'s acceptance criteria.
  retries: CI ? 1 : 0,
  reporter: [...baseReporter, ...timingsReporter],
  use: {
    // Relative page.goto()/request URLs resolve against the client shell —
    // matches e2e/config.ts's single-shell entry ([8.5.2]).
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Deliberately NOT 'on-first-retry' to match `trace` above (#440
    // considered it and rejected it). Two reasons, neither about speed:
    // locally `retries` is 0, so 'on-first-retry' would record nothing at
    // all for a developer debugging a failure; and in CI it keeps the
    // video of the *retry*, so a test that fails then passes leaves you a
    // recording of the passing run — useless for the flake hunting this
    // repo runs a nightly workflow for. 'retain-on-failure' records every
    // attempt and keeps the ones that failed, which is the artifact you
    // actually want. Measured at no wall-time cost either way (4 passing
    // tests x 2 runs: 4.0-4.4s for both settings), so there is no speed
    // argument on the other side.
    video: 'retain-on-failure',
  },
  // iOS Safari (WebKit) is a real share of Bangladeshi device traffic and
  // where CSS/date-input differences tend to surface first, so it's the one
  // to bring back first when cross-browser coverage is worth the CI time.
  // `setup` logs in every seed role once per shard and writes storageState
  // files ([8.5.2], e2e/fixtures/auth.setup.ts); every browser project
  // depends on it so specs can `test.use(loggedIn(role))`.
  projects: [
    { name: 'setup', testMatch: /fixtures\/auth\.setup\.ts/ },
    ...browsers.map((name) => ({
      name,
      use: { ...BROWSER_DEVICES[name] },
      dependencies: ['setup'],
    })),
  ],
  webServer: [
    {
      command: 'yarn dev:server',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'yarn dev:client-admin',
      url: 'http://localhost:5174/',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
