import { defineConfig } from '@playwright/test';

import baseConfig from '../playwright.config';

/**
 * [8.5.4] Route-screenshot visual suite. Separate config on purpose:
 * a bare `yarn e2e` never runs it (baselines are Linux-only; see
 * e2e/VISUAL.md). Reuses the main config's webServer/browser policy.
 */
export default defineConfig({
  ...baseConfig,
  testDir: './visual',
  // The main config ignores visual/ so `yarn e2e` skips this suite —
  // undo that inherited ignore here.
  testIgnore: [],
  testMatch: /routes\.visual\.spec\.ts/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
    },
  },
  use: {
    ...baseConfig.use,
    viewport: { width: 1280, height: 800 },
    contextOptions: { reducedMotion: 'reduce' },
  },
});
