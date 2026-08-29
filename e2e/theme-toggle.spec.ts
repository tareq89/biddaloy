import { expect, guest, test } from './fixtures/test';

/**
 * [8.13.12] (#353) — the user-facing toggle itself: clicking it, the choice
 * surviving a reload, and an explicit choice beating the OS preference.
 * `color-scheme.spec.ts` covers the two inputs a visitor never touches
 * directly (the OS preference, a choice seeded straight into
 * `localStorage`) and the no-flash-on-first-paint guarantee; this file is
 * only about the click path a real user takes.
 *
 * `/login` is used because it is reachable signed-out and — per
 * `login.tsx` — renders `<ThemeToggle />` next to `<LocaleSwitcher />`.
 */

function themeToggle(page: import('@playwright/test').Page) {
  // The accessible name names the theme a click switches TO, not the one
  // currently active — see `theme-toggle.tsx`'s own comment. Both names are
  // matched here since which one is visible depends on the resolved theme
  // when the page loads.
  return page.getByRole('button', { name: /Switch to (dark|light) theme/ });
}

test.describe('clicking the toggle', () => {
  test.use(guest);

  test('flips data-theme, persists the choice, and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');

    const toggle = themeToggle(page);
    await expect(toggle).toHaveAccessibleName('Switch to dark theme');
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();

    await toggle.click();

    await expect(toggle).toHaveAccessibleName('Switch to light theme');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBe('dark');

    await page.reload();

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
    await expect(themeToggle(page)).toHaveAccessibleName('Switch to light theme');
  });
});

test.describe('an explicit choice made through the toggle beats the OS preference', () => {
  test.use(guest);

  test('choosing light while the OS prefers dark stays light after a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');

    // No stored choice yet + dark OS preference -> starts dark, per
    // `color-scheme.spec.ts`'s "no stored choice" contract.
    const toggle = themeToggle(page);
    await expect(toggle).toHaveAccessibleName('Switch to light theme');

    await toggle.click(); // now an explicit, persisted 'light' choice

    await expect(toggle).toHaveAccessibleName('Switch to dark theme');
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();

    // Still under a dark OS preference — proves the stored choice, not the
    // OS, is what a reload resolves against.
    await page.reload();

    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();
    await expect(themeToggle(page)).toHaveAccessibleName('Switch to dark theme');
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBe('light');
  });
});
