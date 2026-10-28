/**
 * [Epic 42] Media for the "Open on your phone and install" guide page (`start.phone`).
 * Only the app's own part can be shot: the account menu with "Install app".
 * Chrome's install dialog, Chrome's menu and Safari's share sheet are browser
 * UI that Playwright cannot capture, so those images are taken on a real device.
 * The "Install app" row shows only when the browser fires `beforeinstallprompt`,
 * so the tour fires it itself.
 */
import { expect, test } from '@playwright/test';

import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const nav = lang === 'bn' ? bnNav : enNav;
const dir = imgDir('start');

test('phone: account menu with Install app', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const menu = page.getByRole('button', { name: new RegExp(nav.userMenu.label) });
  const install = page.getByRole('menuitem', { name: nav.installPrompt.menuItem });
  await expect(async () => {
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, { prompt: () => Promise.resolve(), userChoice: new Promise(() => {}) });
      window.dispatchEvent(event);
    });
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
    await expect(install).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await shoot(page, `${dir}/phone-01-install-menu.png`, [{ target: menu }, { target: install }]);
});
