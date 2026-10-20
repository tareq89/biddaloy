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
    // Pinned (security Rule 21). `serve` resolves /bn/pricing/ to its index.html like the real nginx does.
    command: 'npx --yes serve@14.2.4 landing/dist -l 4321 --no-clipboard',
    url: 'http://localhost:4321/bn/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'landing', use: { ...devices['Desktop Chrome'] } }],
});
