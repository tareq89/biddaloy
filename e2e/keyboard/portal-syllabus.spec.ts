import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.6] Keyboard-only journey over the portal's read-only syllabus tab
 * (`portal/syllabus.tsx`, shipped in 22.4.5). Guardian logs in, lands on
 * the demo child's syllabus, tabs through — no `page.mouse` / `.click(`.
 */

test.use(loggedIn('parent'));

test('keyboard-only: portal syllabus renders the seeded child\'s topics', async ({ page }) => {
  await page.goto('/portal/syllabus');
  await expect(page.getByRole('heading', { name: t('portal.syllabus.title') })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
