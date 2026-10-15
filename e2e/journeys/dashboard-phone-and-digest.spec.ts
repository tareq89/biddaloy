import type { Page } from '@playwright/test';

import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.5.99] Two wave-5 behaviours that only a real browser can prove:
 *  - the phone dashboard has no `<button>` inside a `<button>` (the `:has()`-based fix in
 *    `dashboard-grid.tsx`), including for a tile whose card fell back to its error state;
 *  - the "Morning summary" checkbox on `/security` round-trips through
 *    `PATCH /users/me/preferences/digest` and survives a reload.
 */

const NESTED_BUTTON = /cannot (contain|be a descendant).*button|validateDOMNesting|hydration/i;

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && NESTED_BUTTON.test(m.text())) bad.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (NESTED_BUTTON.test(e.message)) bad.push(e.message);
  });
  return bad;
}

test.describe('phone dashboard: no nested buttons', () => {
  test.use(loggedIn('office_staff'));
  test.use({ viewport: { width: 390, height: 844 } });

  test('tiles, including one whose card failed to load, nest no button and log no DOM error', async ({
    page,
  }) => {
    const bad = watchConsole(page);
    // 404 (not 5xx): a server error is retried with back-off, this one fails at once.
    await page.route('**/api/v1/dashboard/widgets/guardians-incomplete', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"gone"}' }),
    );
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    const phone = page.getByTestId('grid-phone');
    // The failed tile is a compact card with its own expand button; the overlay toggle that would
    // otherwise cover it hides itself (CSS :has()), so the card's control is the one that works.
    const own = phone.getByRole('region', {
      name: t('dashboard.widgets.guardians-incomplete.title'),
    });
    const ownButton = own.getByRole('button').first();
    await expect(ownButton).toBeVisible();
    await ownButton.click();
    const retry = own.getByRole('button', { name: t('dashboard.states.retry') });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    expect(await phone.locator('button button').count()).toBe(0);
    // Healthy tiles still get a working overlay toggle.
    await expect(phone.locator('[data-tile-toggle]:visible').first()).toBeVisible();

    expect(bad, bad.join('\n')).toEqual([]);
  });
});

test.describe('morning summary toggle', () => {
  test.use(loggedIn('admin'));

  test('on/off round-trips and survives a reload', async ({ page }) => {
    await page.goto('/security');
    const box = page.getByRole('checkbox', { name: t('dashboard.digest.toggle') });
    await expect(box).toBeVisible();
    await expect(box).toBeEnabled();
    const start = await box.isChecked();

    const save = () =>
      page.waitForResponse(
        (r) => r.url().includes('/users/me/preferences/digest') && r.request().method() === 'PATCH',
      );
    let saved = save();
    await box.click();
    expect((await saved).status()).toBe(200);
    await expect(box).toBeChecked({ checked: !start });

    await page.reload();
    const after = page.getByRole('checkbox', { name: t('dashboard.digest.toggle') });
    await expect(after).toBeEnabled();
    await expect(after).toBeChecked({ checked: !start });

    // Put it back so the seed stays as found.
    saved = save();
    await after.click();
    expect((await saved).status()).toBe(200);
    await expect(after).toBeChecked({ checked: start });
  });
});
