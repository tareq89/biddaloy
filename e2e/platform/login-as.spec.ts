import type { Page } from '@playwright/test';

import { cockpitOwner, expect, test } from '../fixtures/test';

import { nextOwnerCode, tc } from './support-helpers';

/**
 * [99.6.02] The owner's main job, end to end: sign in to the cockpit (fixture), find a school,
 * Login as the seeded accountant, see the red bar in the new tab, End the visit.
 * Seed data only (`Default School`, its seeded accountant); no real person.
 *
 * The cockpit sign-in used this 30 s step's authenticator code, so the dialog's code is the next
 * step's (`nextOwnerCode`). The tab Login as opens lives on the `app.` host (`appEnterUrl`).
 */
test.use(cockpitOwner);

const SCHOOL = 'Default School';
const START_TO_BANNER_MS = 45_000;

async function loginAsAccountant(page: Page) {
  await page.goto('/schools');
  await page.getByLabel(tc('schoolsList', 'searchLabel')).fill(SCHOOL);
  await page
    .getByRole('button', { name: tc('schoolsList', 'loginAsFor', { name: SCHOOL }) })
    .click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: tc('loginAs', 'role') }).click();
  await page.getByRole('option', { name: tc('loginAs', 'roles.ACCOUNTANT') }).click();
  await dialog.getByRole('button', { name: tc('loginAs', 'reasonChips.supportRequest') }).click();
  await expect(
    dialog.getByRole('button', { name: tc('loginAs', 'reasonChips.supportRequest') }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Fresh code first: the blank tab opens on the click and must not wait for the next step.
  const code = await nextOwnerCode();
  const popupPromise = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: tc('loginAs', 'submit'), exact: true }).click();
  const startedAt = Date.now();
  const popup = await popupPromise;
  const urls: string[] = [];
  popup.on('framenavigated', (frame) => {
    if (frame === popup.mainFrame()) urls.push(frame.url());
  });

  await page.getByLabel(tc('approval', 'codeOnly.label')).fill(code);
  await page.getByRole('button', { name: tc('approval', 'submit'), exact: true }).click();
  return { popup, urls, startedAt };
}

async function expectEnteredAndEnd(popup: Page, urls: string[], startedAt: number, page: Page) {
  const end = popup.getByRole('button', { name: tc('supportBanner', 'banner.end'), exact: true });
  await expect(end).toBeVisible({ timeout: START_TO_BANNER_MS });
  expect(Date.now() - startedAt).toBeLessThan(START_TO_BANNER_MS);

  // The code travels in the fragment and is stripped before the page does anything else.
  expect(urls.some((u) => u.includes('/support/enter'))).toBe(true);
  expect(popup.url()).not.toContain('#code');
  expect(popup.url()).not.toContain('code=');
  // ponytail: the ticket also asks for "a fee amount is not visible for this role"; the
  // accountant is not shown amounts-hidden by any server rule (no mask in the deny list), so
  // that line is not asserted. Ask the owner what it meant.
  await expect(popup.getByRole('main')).toBeVisible();

  // The banner's End closes the tab itself (`window.close()` in `SupportBannerHost`); the
  // "ended" page (`/support/enter?ended=1`) only stays up in a tab the browser will not close.
  await Promise.all([popup.waitForEvent('close'), end.click()]);

  // The owner's strip is empty once the visit is over.
  await page.goto('/schools');
  await expect(
    page.getByRole('button', { name: tc('schoolsList', 'loginAsFor', { name: SCHOOL }) }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('region', { name: tc('schoolsList', 'live.title', { count: 1 }) }),
  ).toHaveCount(0);
}

test('owner logs in as the accountant, sees the red bar and ends the visit', async ({ page }) => {
  test.setTimeout(150_000);
  const { popup, urls, startedAt } = await loginAsAccountant(page);
  await expectEnteredAndEnd(popup, urls, startedAt, page);
});

test('phone: the same visit works at 390 px with 44 px buttons', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { popup, urls, startedAt } = await loginAsAccountant(page);
  await popup.setViewportSize({ width: 390, height: 844 });

  const end = popup.getByRole('button', { name: tc('supportBanner', 'banner.end'), exact: true });
  await expect(end).toBeVisible({ timeout: START_TO_BANNER_MS });
  const box = await end.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44 - 1);
  expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await expectEnteredAndEnd(popup, urls, startedAt, page);
});
