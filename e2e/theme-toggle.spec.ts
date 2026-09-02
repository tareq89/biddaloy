import { expect, guest, test } from './fixtures/test';

/**
 * [8.14.2] rebuilds the old two-state light/dark toggle button
 * ([8.13.12]/#353) into a tri-state `Menu` — this file is rewritten
 * accordingly: it now opens the menu and picks a `MenuRadioItem` rather
 * than clicking a single button. `color-scheme.spec.ts` still covers the
 * two inputs a visitor never touches directly (the OS preference, a
 * choice seeded straight into `localStorage`) and the no-flash-on-
 * first-paint guarantee; this file is only about the click path a real
 * user takes.
 *
 * `/login` is used because it is reachable signed-out and — per
 * `login.tsx` — renders `<ThemeToggle />` next to `<LocaleSwitcher />`.
 */

function themeMenuTrigger(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Theme' });
}

async function chooseTheme(
  page: import('@playwright/test').Page,
  choice: 'Light' | 'Dark' | 'System',
) {
  await themeMenuTrigger(page).click();
  await page.getByRole('menuitemradio', { name: choice }).click();
}

test.describe('choosing a theme from the menu', () => {
  test.use(guest);

  test('Light -> data-theme absent, persisted', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');

    // No stored choice yet + dark OS preference -> starts dark, per
    // `color-scheme.spec.ts`'s "no stored choice" contract.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );

    await chooseTheme(page, 'Light');

    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBe('light');

    // Still under a dark OS preference — proves the stored choice, not
    // the OS, is what a reload resolves against.
    await page.reload();

    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();
  });

  test('Dark -> data-theme="dark", persisted', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');

    await chooseTheme(page, 'Dark');

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBe('dark');

    await page.reload();

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
  });

  test('System -> clears the storage key and follows prefers-color-scheme live', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');

    // Pick an explicit choice first so there is something for "System" to
    // clear — otherwise this test can't tell "cleared" from "never set".
    await chooseTheme(page, 'Dark');
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBe('dark');

    await chooseTheme(page, 'System');

    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBeNull();
    // OS still prefers light here, so "System" resolves back to light.
    expect(
      await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBeNull();

    // Flips live with the OS preference while "System" is active — no
    // reload, no further click.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe('dark');

    // Survives a reload as "System", not as a stored 'dark' choice.
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('biddaloy:theme'))).toBeNull();
  });
});
