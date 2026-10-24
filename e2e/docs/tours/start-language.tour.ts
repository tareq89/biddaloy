/**
 * [Epic 42] Media for the "Changing the language" guide page (`start.language`).
 * Shoots the top-bar language list on desktop and the account-menu route on a phone.
 */
import { expect, test, type Locator } from '@playwright/test';

import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const nav = lang === 'bn' ? bnNav : enNav;
const dir = imgDir('start');

/** The dev client can still be hydrating when the first click lands; click until the menu is open. */
async function openMenu(trigger: Locator, probe: Locator): Promise<void> {
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(probe).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

test('desktop: language list in the top bar', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const button = page.getByRole('button', { name: nav.language.label });
  const list = page.getByRole('menu');
  await openMenu(button, list);
  await shoot(page, `${dir}/language-01-topbar.png`, [{ target: button }, { target: list }]);
});

test('phone: language in the account menu', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const menu = page.getByRole('button', { name: new RegExp(nav.userMenu.label) });
  const row = page.getByRole('menuitem', { name: new RegExp(nav.language.groupLabel) });
  await openMenu(menu, row);
  await row.click();
  const choices = page.getByRole('menuitemradio');
  await expect(choices.first()).toBeVisible();
  await shoot(page, `${dir}/language-phone-01-menu.png`, [
    { target: row },
    { target: choices.first().locator('..') },
  ]);
});
