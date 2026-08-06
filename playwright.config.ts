import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-shell E2E harness — `e2e/` isn't a yarn workspace (it tests across
 * `client-admin`/`client-student`, not inside either one), same reasoning as
 * the root `vitest.config.ts` covering multiple frontend packages from a
 * single top-level config.
 *
 * `webServer` boots the real API (`dev:server`) plus every client dev
 * server, the same processes `yarn dev:*` starts for a human — not a
 * separate CI-only build path. Locally that means: bring up Postgres/Redis
 * with `docker compose up -d db redis` (see README's Development section),
 * migrate + seed once, then `yarn e2e` reuses that stack via
 * `reuseExistingServer`. CI has no persistent stack, so it migrates, seeds,
 * and lets Playwright start and tear down all three servers itself.
 */
const CI = !!process.env.CI;

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
  // Chromium only for now — Firefox and WebKit are commented out rather
  // than deleted so a later ticket can re-enable them by uncommenting
  // instead of re-deriving the device config. iOS Safari (WebKit) is a
  // real share of Bangladeshi device traffic and where CSS/date-input
  // differences tend to surface first, so it's the one to bring back
  // first when cross-browser coverage is worth the CI time again.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
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
      command: 'yarn dev:client-student',
      url: 'http://localhost:5173/student/',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'yarn dev:client-admin',
      url: 'http://localhost:5174/admin/',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
