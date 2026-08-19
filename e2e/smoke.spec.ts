import { test, expect } from '@playwright/test';

import { shells } from './config';

// Proves the harness itself — server + both clients boot, migrate/seed ran,
// and all three browser projects can reach each shell. Real per-shell
// coverage lands with page objects in [8.5.3].
for (const [name, shell] of Object.entries(shells)) {
  test(`${name} shell loads`, async ({ page }) => {
    await page.goto(shell.baseURL);
    await expect(page.getByRole('heading', { name: shell.heading })).toBeVisible();
  });
}
