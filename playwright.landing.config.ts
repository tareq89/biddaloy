import { defineConfig, devices } from '@playwright/test';

/**
 * [50.13] Smoke tests for the built landing site (`landing/dist`), served as plain static files.
 * Separate from `playwright.config.ts`: no API, no database, no login, just files.
 * Run: `yarn workspace @biddaloy/landing build && npx playwright test -c playwright.landing.config.ts`
 */
export default defineConfig({
  testDir: './e2e/landing',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    // `serve` is a locked landing devDependency (Rule 21). It resolves /bn/pricing/ to its index.html like the real nginx does.
    command: 'yarn workspace @biddaloy/landing serve',
    url: 'http://localhost:4321/bn/',
    reuseExistingServer: true, // CI starts the same server first (shared with Lighthouse)
    timeout: 60_000,
  },
  projects: [{ name: 'landing', use: { ...devices['Desktop Chrome'] } }],
});
