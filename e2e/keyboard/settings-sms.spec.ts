import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { openFromSidebar, tabToLocator, tabUntilFocused } from './keyboard-utils';

/**
 * [#3304] Settings › Communication › SMS, KEYBOARD ONLY: reach Settings from the sidebar, open
 * the Communication category, then Tab to the company picker, each field, Test connection,
 * Send a test message (after typing a number) and Save, with no focus trap. Nothing is pressed
 * that calls a company, so no vendor stub is needed. No `.click(` in this file.
 */
const t = makeT('en');

test.use({ ...loggedIn('admin'), e2eLocale: 'en', actionTimeout: 15_000 });

test('sidebar to Settings, Communication, then every SMS control by Tab', async ({ page }) => {
  test.setTimeout(90_000);
  await openFromSidebar(page, t('nav.items.settings'));

  await tabUntilFocused(page, t('settings.communication'), 60, { exact: false });
  await page.keyboard.press('Enter');
  const section = page.locator('#sms-section');
  await expect(section).toBeVisible();

  await tabToLocator(page, section.getByRole('combobox', { name: t('settings.sms.provider') }));
  await tabToLocator(
    page,
    section.getByRole('button', { name: t('settings.testConnection.action') }),
  );
  await tabToLocator(page, section.getByLabel(t('settings.sendTestMessage.phone')));
  await page.keyboard.type('01712345678');
  await tabToLocator(
    page,
    section.getByRole('button', { name: t('settings.sendTestMessage.label') }),
  );
  await tabToLocator(page, section.getByRole('button', { name: t('settings.save.action') }));
});
