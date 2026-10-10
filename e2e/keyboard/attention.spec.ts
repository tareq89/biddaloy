import type { Page } from '@playwright/test';

import { raiseTrialEnding } from '../api';
import { expectNoAxeViolations } from '../a11y/assert';
import { shells } from '../config';
import { newSchool, skipSetup, type NewSchool } from '../fixtures/new-school';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [67.2.10] The attention bar and its modal, KEYBOARD ONLY (D16), on staff
 * (real engine, a trial school with 6 days left), the palette, the portal
 * (alerts stubbed: W2 has no portal rule) and a phone width. English UI.
 */
const t = makeT('en');
const BAR = '[data-tone] button[aria-haspopup="dialog"]';

const setEnglish = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));

/** Reset the tab cursor, skip link, Enter, then one Tab: the bar is first in `<main>`. */
async function tabToBar(page: Page) {
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator(BAR)).toBeFocused();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: t('attention.modal.title') });

/** Waits out the dialog's open transition (it fades and scales in), which skews colours and size. */
const settled = (page: Page) =>
  dialog(page).evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );

async function scanDialog(page: Page) {
  await settled(page);
  await expectNoAxeViolations(page, '[role="dialog"]');
}

test.describe('staff', () => {
  test.use(guest);
  test.setTimeout(120_000);
  let school: NewSchool;

  test.beforeEach(async ({ browser, playwright }) => {
    school = await newSchool(browser, playwright);
    await skipSetup(school.page);
    await setEnglish(school.page);
    await raiseTrialEnding(playwright, school.session.tenantId, shells.app.baseURL);
    // The recheck runs about 5 s after the trial change.
    await expect
      .poll(
        async () => {
          await school.page.goto('/dashboard');
          return school.page
            .locator(BAR)
            .waitFor({ timeout: 3_000 })
            .then(
              () => 1,
              () => 0,
            );
        },
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    await school.context.close();
    await school.api.dispose();
  });

  test('bar, modal, arrows, Esc returns focus, Enter on a card opens the trial details', async () => {
    const { page } = school;
    await tabToBar(page);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await scanDialog(page);

    const cards = dialog(page).locator('[data-alert-item]');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(dialog(page).locator(':focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator(BAR)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\?trial=1/);
    await expect(page.getByRole('dialog', { name: t('trial.details.title') })).toBeVisible();
  });

  test('palette: "Show alerts" opens the modal, Esc drops the flag', async () => {
    const { page } = school;
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3'); // Action tab
    await page.keyboard.type('Show alerts');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notifications\?.*alerts=1/);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page).not.toHaveURL(/alerts=/);
  });

  test('phone: the dialog covers the screen and the bar is a 44 px target', async () => {
    const { page } = school;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(page.locator(BAR)).toBeVisible();
    const bar = await page.locator('[data-tone]:has(button[aria-haspopup="dialog"])').boundingBox();
    expect(bar?.height).toBeGreaterThanOrEqual(44);
    await tabToBar(page);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await settled(page);
    expect((await dialog(page).boundingBox())?.width).toBe(390);
    await page.keyboard.press('Escape');
    await expect(page.locator(BAR)).toBeFocused();
  });
});

test.describe('portal', () => {
  test.use(loggedIn('parent'));
  // The production build's service worker fetches /api itself, and `page.route()`
  // never sees a request a service worker makes: without this the real, seeded
  // items reach the modal instead of the stub (same as focus-management.spec.ts).
  test.use({ serviceWorkers: 'block' });

  test('bar, modal with the child line, Esc returns focus, Enter on the card goes to fees', async ({
    page,
  }) => {
    await setEnglish(page);
    const item = {
      recipientId: 'e2e-recipient',
      alertId: 'e2e-alert',
      ruleKey: 'fees.overdue_family',
      source: 'RULE',
      severity: 'WARNING',
      category: 'FAMILY',
      state: 'OPEN',
      title: 'Fee overdue',
      why: 'A fee is overdue.',
      steps: [],
      actionLabel: 'Pay now',
      actionUrl: '/portal/fees',
      closable: true,
      raisedAt: new Date().toISOString(),
      studentName: 'Rafi Ahmed',
      sectionLabel: 'Class 5 A',
    };
    await page.route('**/api/v1/attention/summary*', (route) =>
      route.fulfill({
        json: {
          critical: 0,
          warning: 1,
          reminder: 0,
          activeTotal: 1,
          top: item,
          updatedAt: new Date().toISOString(),
          staleMinutes: 0,
        },
      }),
    );
    await page.route('**/api/v1/attention/items*', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { items: [item], total: 1 } })
        : route.continue(),
    );

    await page.goto('/portal');
    await expect(page.locator(BAR)).toBeVisible();
    await tabToBar(page);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(
      t('attention.item.about', { student: item.studentName, section: item.sectionLabel }),
    );
    await scanDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(BAR)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog(page).locator('[data-alert-item]').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/portal\/fees/);
  });
});
