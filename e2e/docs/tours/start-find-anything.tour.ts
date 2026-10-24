/**
 * [Epic 42] Media for the "Finding any page" guide page (`start.findAnything`):
 * the Ctrl+K window on desktop, the top row (search button + bell) on a phone.
 */
import { expect, test } from '@playwright/test';

import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const nav = lang === 'bn' ? bnNav : enNav;
const palette = nav.commandPalette;
const dir = imgDir('start');

test('desktop: search window', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'admin');
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await page.getByPlaceholder(palette.placeholder).fill('a');
  await expect(dialog.getByRole('tablist')).toBeVisible();
  await shoot(page, `${dir}/find-anything-01-palette.png`, [
    { target: dialog.getByRole('combobox').or(dialog.getByRole('textbox')).first() },
    { target: dialog.getByRole('tablist') },
    { target: dialog.getByRole('listbox').or(dialog.getByRole('option').first()).first() },
    { target: dialog.getByText(palette.searchableHint).first() },
  ]);
});

test('phone: search button and bell', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'admin');
  const search = page.getByRole('button', { name: new RegExp(palette.ariaLabel) }).first();
  const bell = page.getByRole('button', { name: /^(Notifications|বিজ্ঞপ্তি)/ }).first();
  await expect(search).toBeVisible();
  await shoot(page, `${dir}/find-anything-phone-01-search.png`, [
    { target: search },
    { target: bell },
  ]);
});
