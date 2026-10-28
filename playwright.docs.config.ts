import { defineConfig, devices } from '@playwright/test';

/**
 * [Epic 42] User-guide capture. Not a test suite: each `*.tour.ts` drives the
 * demo school and writes screenshots and GIFs into `docs/user-guide/<lang>/`.
 *
 * It needs a DEMO_MODE server on a `seed:demo` database and the client on
 * :5174, already running (docs/architecture/22-demo-seed.md, "Running the demo
 * end to end"). Run it once per language; GUIDE_LANG must match the project's:
 *
 *   GUIDE_LANG=bn npx playwright test -c playwright.docs.config.ts --project=bn-desktop --project=bn-phone attendance
 *   GUIDE_LANG=en npx playwright test -c playwright.docs.config.ts --project=en-desktop --project=en-phone attendance
 */
export default defineConfig({
  testDir: './e2e/docs/tours',
  testMatch: '**/*.tour.ts',
  outputDir: './test-results/guide',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: process.env.GUIDE_BASE_URL ?? 'http://localhost:5174',
    colorScheme: 'light', // D31
    deviceScaleFactor: 1,
    trace: 'off',
  },
  projects: (['bn', 'en'] as const).flatMap((lang) => [
    {
      name: `${lang}-desktop`,
      metadata: { lang, device: 'desktop' },
      use: { locale: lang, viewport: { width: 1440, height: 900 } },
    },
    // D6: 390 px phone, no bezel (D32). Pixel 7's UA so the app picks its phone layout.
    {
      name: `${lang}-phone`,
      metadata: { lang, device: 'phone' },
      use: {
        ...devices['Pixel 7'],
        locale: lang,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      },
    },
  ]),
});
