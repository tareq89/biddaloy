/**
 * [Epic 42] Media for the "Signing in" guide page (`start.signIn`): the empty
 * sign-in form on desktop and on a phone. No login, so no demo card is used.
 */
import { expect, test } from '@playwright/test';

import bnAuth from '../../../ui/src/i18n/locales/bn/auth.json';
import enAuth from '../../../ui/src/i18n/locales/en/auth.json';
import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import bnDemo from '../../../ui/src/i18n/locales/bn/demo.json';
import enDemo from '../../../ui/src/i18n/locales/en/demo.json';
import { guideLang, imgDir, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const auth = lang === 'bn' ? bnAuth : enAuth;
const nav = lang === 'bn' ? bnNav : enNav;
const demo = lang === 'bn' ? bnDemo : enDemo;
const dir = imgDir('start');

test('sign-in form', async ({ page }, info) => {
  const phone = info.project.metadata.device === 'phone';
  await prepare(page);
  await page.goto('/login');
  // Demo school: the own-account form starts folded under the role cards.
  await page.getByRole('button', { name: demo.ownAccount }).click();
  await expect(page.getByRole('tab', { name: auth.tabs.password })).toBeVisible();
  const identifier = page.getByLabel(auth.identifier.label);
  const password = page.getByLabel(auth.password.label, { exact: true });
  const submit = page.getByRole('button', { name: auth.submit.action, exact: true });
  const language = page.getByRole('button', { name: new RegExp(nav.language.label) });
  const file = `${dir}/sign-in-${phone ? 'phone-' : ''}01-form.png`;
  await shoot(
    page,
    file,
    phone
      ? []
      : [
          { target: language },
          { target: page.getByRole('tablist') },
          { target: identifier },
          { target: password },
          { target: submit },
          { target: page.getByRole('link', { name: auth.forgot.link }).first() },
        ],
  );
});
