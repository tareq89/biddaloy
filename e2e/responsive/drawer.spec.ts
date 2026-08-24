import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.5.6] Mobile sidebar drawer at 320 px: opens from the hamburger,
 * traps focus (25 Tab presses never leave it), Escape closes and
 * restores focus to the trigger.
 */

test.use({ ...loggedIn('admin'), viewport: { width: 320, height: 900 } });

test('drawer opens, traps focus, and restores it on close', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: t('nav.openMenuLabel') });

  await test.step('open moves focus into the drawer', async () => {
    await trigger.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const focusInside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(focusInside).toBe(true);
  });

  await test.step('25 Tab presses stay inside', async () => {
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(document.activeElement) ?? false;
      });
      expect(inside, `Tab press ${i + 1} left the drawer`).toBe(true);
    }
  });

  await test.step('Escape closes and returns focus to the trigger', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
