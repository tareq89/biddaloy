import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.6] Keyboard-only journey over the portal's read-only syllabus tab
 * (`portal/syllabus.tsx`, shipped in 22.4.5). Guardian logs in, lands on
 * the demo child's syllabus, tabs through — no `page.mouse` / `.click(`.
 */

test.use(loggedIn('parent'));

test('keyboard-only: portal syllabus subject disclosure opens and shows the next lessons', async ({
  page,
}) => {
  await page.goto('/portal/syllabus');
  await expect(
    page.getByRole('heading', { name: t('portal.syllabus.title'), exact: true }),
  ).toBeVisible();

  // Tab until focus lands on the first subject disclosure (a button with aria-expanded).
  const disclosure = page.locator('button[aria-expanded]').first();
  await expect(disclosure).toBeVisible();
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    if (await disclosure.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(disclosure).toBeFocused();

  // Enter toggles it (the most-behind subject starts open, an on-time one closed).
  const before = await disclosure.getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
  if (before === 'true') await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('heading', { name: t('portal.syllabus.plan.nextFive'), exact: true }).first(),
  ).toBeVisible();
});
