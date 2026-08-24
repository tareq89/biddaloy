import { defineConfig, devices } from '@playwright/test';

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
  fullyParallel: true,
  forbidOnly: CI,
  // A suite needing more than one CI retry is hiding flake — see
  // [8.5.1]'s acceptance criteria.
  retries: CI ? 1 : 0,
  reporter: CI ? [['html', { open: 'never' }], ['list']] : [['html', { open: 'on-failure' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // iOS Safari (WebKit) is a real share of Bangladeshi device traffic and
  // where CSS/date-input differences tend to surface first, so it's the one
  // to bring back first when cross-browser coverage is worth the CI time.
  projects: browsers.map((name) => ({ name, use: { ...BROWSER_DEVICES[name] } })),
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
