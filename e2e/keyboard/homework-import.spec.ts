import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.6] Keyboard-only journey over the homework import page
 * (`academics/homework/import.tsx`, shipped in 22.4.4). Tabs to the
 * template-download button and activates it with `Enter` — no
 * `page.mouse` / `.click(` anywhere.
 */

test.use(loggedIn('admin'));

test('keyboard-only: homework import page downloads the template via Enter', async ({ page }) => {
  await page.goto('/academics/homework/import');
  await expect(
    page.getByRole('heading', { name: t('homework.import.title') }),
  ).toBeVisible();

  const downloadButton = page.getByRole('button', {
    name: t('homework.import.template.download'),
  });
  await downloadButton.focus();
  await expect(downloadButton).toBeFocused();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  expect(download.suggestedFilename()).toBe('homework-import-template.csv');
});
