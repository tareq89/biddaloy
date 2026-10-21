import { expect, test } from '@playwright/test';

test('switching language keeps the path', async ({ page }) => {
  await page.goto('/bn/pricing/');
  await page.locator('a[hreflang="en"][data-ev="lang_switch"]').click();
  await expect(page).toHaveURL(/\/en\/pricing\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('theme toggle persists across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/en/');
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
