import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { tabUntilFocused } from './keyboard-utils';

/**
 * [8.10.7.5.99] Keyboard-only path through the committee report: dashboard print link, report
 * heading focus, Print and Back, and the command palette action. No `page.mouse` / `.click(`.
 */

test.use(loggedIn('committee'));

const report = (page: import('@playwright/test').Page) =>
  page.getByRole('heading', { level: 1, name: t('dashboard.committeeReport.title') });

test('Tab to the print link, Enter, focus lands on the report heading, Back returns', async ({
  page,
}) => {
  await page.goto('/dashboard');
  const print = page.getByRole('link', { name: t('dashboard.committeeSummary.printReport') });
  await expect(print).toBeVisible();
  await tabUntilFocused(page, t('dashboard.committeeSummary.printReport'));
  await page.keyboard.press('Enter');

  await expect(report(page)).toBeVisible();
  await expect(report(page)).toBeFocused();

  await tabUntilFocused(page, t('dashboard.committeeReport.print'), 90, { exact: true });
  await tabUntilFocused(page, t('dashboard.committeeReport.back'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard/);
});

test('Ctrl+K, ">", type, Enter opens the report', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(
    page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
  ).toBeFocused();
  await page.keyboard.type('>');
  await page.keyboard.type('সভার');
  await page.keyboard.press('Enter');
  await expect(report(page)).toBeVisible();
});
