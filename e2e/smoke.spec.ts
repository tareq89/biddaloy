import { test, expect } from '@playwright/test';

import { shells } from './config';

// Proves the harness itself — server + client boot, migrate/seed ran, and
// every browser project can reach the app. Real per-shell coverage (an
// authenticated path, the role-aware `/` redirect) lands with page objects
// in [8.5.3].
for (const [name, shell] of Object.entries(shells)) {
  test(`${name} shell loads`, async ({ page }) => {
    await page.goto(shell.baseURL);
    await expect(page.getByRole('heading', { name: shell.heading })).toBeVisible();
  });
}
