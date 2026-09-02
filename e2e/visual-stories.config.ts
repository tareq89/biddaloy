import { defineConfig } from '@playwright/test';

import baseConfig from '../playwright.config';

/**
 * [8.5.4] Storybook component-level visual suite. Builds the static
 * Storybook and serves it with the dependency-free static server in
 * scripts/serve-static.mjs — no app/DB stack needed.
 */
export default defineConfig({
  ...baseConfig,
  testDir: './visual',
  // The main config ignores visual/ so `yarn e2e` skips this suite —
  // undo that inherited ignore here.
  testIgnore: [],
  testMatch: /stories\.visual\.spec\.ts/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
    },
  },
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:6006',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: [
    {
      command:
        'yarn workspace @biddaloy/ui build-storybook && node scripts/serve-static.mjs ui/storybook-static 6006',
      // Playwright defaults a webServer's cwd to this config file's own
      // directory (e2e/), but the command above writes its paths as if
      // run from the repo root — point it there explicitly.
      cwd: '..',
      url: 'http://localhost:6006/index.json',
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
  ],
});
