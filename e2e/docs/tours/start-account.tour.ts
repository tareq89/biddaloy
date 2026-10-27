/**
 * [Epic 42] Media for the "Your account" guide page (`start.account`): the
 * account menu and the Security page (active sessions).
 */
import { expect, test, type Locator } from '@playwright/test';

import bnAuth from '../../../ui/src/i18n/locales/bn/auth.json';
import enAuth from '../../../ui/src/i18n/locales/en/auth.json';
import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const nav = lang === 'bn' ? bnNav : enNav;
const auth = lang === 'bn' ? bnAuth : enAuth;
const dir = imgDir('start');

async function openMenu(trigger: Locator, probe: Locator): Promise<void> {
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(probe).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

test('desktop: account menu, then Security', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const menu = page.getByRole('button', { name: new RegExp(nav.userMenu.label) });
  const content = page.getByRole('menu');
  const security = page.getByRole('menuitem', { name: nav.userMenu.security });
  await openMenu(menu, content);
  await shoot(page, `${dir}/account-01-menu.png`, [
    { target: content.getByRole('group').first().or(content.locator('span').first()) },
    { target: content.getByRole('menuitem', { name: new RegExp(nav.language.groupLabel) }) },
    { target: content.getByRole('menuitem', { name: new RegExp(nav.theme.groupLabel) }) },
    { target: security },
    { target: content.getByRole('menuitem', { name: nav.userMenu.signOut }) },
  ]);

  await security.click();
  await expect(page.getByText(auth.sessions.title).first()).toBeVisible();
  await expect(page.getByText(auth.sessions.thisDevice).first()).toBeVisible();
  await shoot(page, `${dir}/account-02-sessions.png`, [
    { target: page.getByText(auth.sessions.title).first() },
    { target: page.getByText(auth.sessions.thisDevice).first() },
  ]);
});
