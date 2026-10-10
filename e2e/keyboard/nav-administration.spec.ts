import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar, tabUntilFocused } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Administration (admin)', () => {
  test.use(loggedIn('admin'));

  test('roles and access', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.rolesAccess'));
    await expectReachableInMain(page);
  });

  test('audit logs', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.auditLogs'));
    await expectReachableInMain(page);
  });

  // [67.6.02] Alerts & reminders: category link, first rule switch, Space toggles, nothing is saved.
  test('settings: alerts and reminders', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.settings'));
    await tabUntilFocused(page, t('settings.categories.alerts'), 40, { tag: 'a' });
    await page.keyboard.press('Enter');
    const firstSwitch = page.locator('[role=switch]:not([disabled])').first();
    await expect(firstSwitch).toBeVisible();
    const name = (await firstSwitch.getAttribute('aria-label')) ?? '';
    await tabUntilFocused(page, name, 40, { exact: true });
    await expect(firstSwitch).toBeFocused();
    const before = await firstSwitch.getAttribute('aria-checked');
    await page.keyboard.press('Space');
    await expect(firstSwitch).not.toHaveAttribute('aria-checked', before ?? '');
    // Space again puts it back: the form is clean, so leaving needs no save or discard.
    await page.keyboard.press('Space');
    await expect(firstSwitch).toHaveAttribute('aria-checked', before ?? '');
    await page.keyboard.press('Tab');
    await expect(page.locator('main :focus')).toHaveCount(1);
  });
});
