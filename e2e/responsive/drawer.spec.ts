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
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 25; i += 1) {
        await page.keyboard.press(key);
        const inside = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.contains(document.activeElement) ?? false;
        });
        expect(inside, `${key} press ${i + 1} left the drawer`).toBe(true);
      }
    }
  });

  await test.step('Escape closes and returns focus to the trigger', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test('drawer is a start-edge full-height sheet with a sticky 44 px close (D13)', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: t('nav.openMenuLabel') }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  // wait out the slide-in so the box is final
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

  const box = (await drawer.boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.abs(box.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1);

  // not vacuous: the nav list is longer than the viewport, so it really scrolls
  expect(await drawer.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  await drawer.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await drawer.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const close = drawer.getByRole('button', { name: t('nav.closeMenuLabel') });
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.y).toBeGreaterThanOrEqual(0);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
});
