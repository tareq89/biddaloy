import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.5.10] Keyboard-only journey over the portal homework page
 * (`portal/homework.tsx`). The seeded family homework item (seed-contract
 * `familyHomework`) is in the demo child's section. No `page.mouse` / `.click(`.
 */

test.use(loggedIn('parent'));

test('keyboard-only: reach portal homework from the nav, focus lands on the h1, list is tabbable', async ({
  page,
}) => {
  await page.goto('/portal');

  // Tab to the "Homework" nav link and open it with Enter.
  const link = page.getByRole('link', { name: t('nav.items.portalHomework'), exact: true }).first();
  await expect(link).toBeVisible();
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    if (await link.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');

  const h1 = page.getByRole('heading', { level: 1, name: t('portal.homework.title'), exact: true });
  await expect(h1).toBeVisible();
  await expect(h1).toBeFocused();

  // The list has at least one due-date group, and Tab walks on without a trap.
  await expect(page.getByRole('main').getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(h1).not.toBeFocused();
});
