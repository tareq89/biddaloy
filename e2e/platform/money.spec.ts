import type { Page } from '@playwright/test';

import { clearOwnerTotpStep, post, put, registerTrialSchool } from '../api';
import { newOwner, resetOwners } from '../cockpit/helpers';
import { shells } from '../config';
import {
  deactivateSmsPackages,
  insertSmsPackage,
  ownerPaysPackageOrder,
  ownerRecordsPayment,
} from '../fixtures/money';
import { cockpitOwner, expect, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { nextStepIn, totpNow } from '../totp';

/**
 * [100.6.03] The platform owner's money job in the cockpit, in the browser: record SMS bought and
 * watch the SMS state action lines change, make an SMS package and switch it off, make a 50 %
 * coupon for one school, refund a paid seat order from the school's billing detail and see the
 * refund taken off on Revenue. A second test checks the SMS state page at 390 px, a third that a
 * 100 % coupon waits for the other owner. English UI, one worker (the owner is shared).
 *
 * The code prompt: a TOTP code is single-use per 30 s step. Instead of waiting for the next step
 * between prompts, the owner's replay marker is cleared first (`clearOwnerTotpStep`, as the
 * cockpit sign-in helper does).
 * Not covered here: approving the 100 % coupon (it needs the other owner to sign in, which needs
 * a mail sink; the approval path is covered by the API e2e-specs of #3893 and the server specs).
 */
const t = makeT('en');
test.use({ ...cockpitOwner, e2eLocale: 'en', actionTimeout: 15_000 });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

/**
 * The code prompt a gated Save opens. A TOTP code is single-use per 30 s step and the sign-in at
 * the start of each test already used one, so every code waits for a step nobody used yet.
 */
let usedStep = 0;
test.beforeEach(() => {
  usedStep = Math.floor(Date.now() / STEP_MS);
});
async function enterCode(page: Page): Promise<void> {
  if (Math.floor(Date.now() / STEP_MS) <= usedStep) {
    await page.waitForTimeout(nextStepIn() + 300);
  }
  usedStep = Math.floor(Date.now() / STEP_MS);
  const label = t('approval.codeOnly.label');
  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel(label) });
  await clearOwnerTotpStep();
  await dialog.getByLabel(label).fill(totpNow());
  await dialog.getByRole('button', { name: t('approval.submit'), exact: true }).click();
}
const STEP_MS = 30_000;

/** The stock slot's own button: the action lines above it can carry the same label, so it is the last. */
const recordButton = (page: Page) =>
  page.getByRole('button', { name: t('moneyStock.record'), exact: true }).last();

/** A number out of a formatted amount ("৳1,250.00" -> 1250). */
const amount = (s: string) => Number(s.replace(/[^0-9.]/g, ''));

const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
let school: Awaited<ReturnType<typeof registerTrialSchool>>;
let seatOrder: { id: string; amount_paisa: number };
let packageId = '';

test.beforeAll(async ({ playwright }) => {
  // The school has a paid seat order (to refund) and a paid 100-SMS package (so the school owes
  // SMS the company balance must cover: the "top up now" line can appear).
  const registrar = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    school = await registerTrialSchool(registrar);
    seatOrder = await post(registrar, school.session, '/billing/orders', {
      seats: 10,
      months: 1,
      idempotency_key: crypto.randomUUID(),
    });
    await ownerRecordsPayment(playwright, 'orders', seatOrder.id);
    await put(registrar, school.session, '/communications/sms-source', {
      source: 'SCHOOLMANAGERP',
    });
    const pkg = await insertSmsPackage('E2E cockpit 100', 100, 30000);
    packageId = pkg.id;
    const order = await post<{ id: string }>(registrar, school.session, '/sms-bundles/orders', {
      package_id: pkg.id,
      idempotency_key: crypto.randomUUID(),
    });
    await ownerPaysPackageOrder(playwright, order.id);
  } finally {
    await registrar.dispose();
  }
});

test.afterAll(async () => {
  await deactivateSmsPackages(packageId);
  await resetOwners();
});

test('record stock, make a package and a coupon, refund an order, read the revenue', async ({
  page,
}) => {
  const recordStock = async (smsCount: string, balance: string) => {
    await recordButton(page).click();
    const dialog = page.getByRole('dialog', { name: t('moneyStock.dialog.title') });
    await dialog.getByLabel(t('moneyStock.dialog.smsCount')).fill(smsCount);
    await dialog.getByLabel(t('moneyStock.dialog.cost')).fill('1000');
    await dialog.getByLabel(t('moneyStock.dialog.balance')).fill(balance);
    await dialog.getByRole('button', { name: t('moneyStock.dialog.save'), exact: true }).click();
    await expect(page.getByText(t('moneyStock.dialog.saved'))).toBeVisible();
    await expect(dialog).toBeHidden();
  };
  const topUpLine = page.getByText(/^The SMS company has only /);

  await test.step('a stock entry showing too little SMS raises the top-up line; a big one clears it', async () => {
    await page.goto('/money');
    await expect(page.getByRole('heading', { name: t('money.title') })).toBeVisible();
    await recordStock('1000', '1');
    await expect(topUpLine).toBeVisible();
    await recordStock('1000', '50000000');
    await expect(topUpLine).toHaveCount(0);
  });

  const packageName = `E2E 5000 SMS ${suffix}`;
  await test.step('a 5,000-SMS package is made with a code, listed, and switched off', async () => {
    await page.goto('/money/packages');
    await page
      .getByRole('button', { name: t('moneyPackages.new'), exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: t('moneyPackages.dialog.newTitle') });
    await dialog.getByLabel(t('moneyPackages.dialog.name'), { exact: true }).fill(packageName);
    await dialog.getByLabel(t('moneyPackages.dialog.smsCount')).fill('5000');
    await dialog.getByLabel(t('moneyPackages.dialog.validityDays')).fill('30');
    await dialog.getByLabel(t('moneyPackages.dialog.price')).fill('2000');
    await dialog.getByRole('button', { name: t('moneyPackages.dialog.save'), exact: true }).click();
    await enterCode(page);
    const row = page.getByRole('row').filter({ hasText: packageName });
    await expect(row).toBeVisible();
    const offer = row.getByRole('switch', {
      name: t('moneyPackages.list.switch', { name: packageName }),
    });
    await expect(offer).toBeChecked();
    await offer.click();
    await expect(offer).not.toBeChecked();
  });

  const couponCode = `E2E-OWN-${suffix}`;
  await test.step('a 50 % coupon for one school is made with a code', async () => {
    await page.goto('/money/coupons');
    await page
      .getByRole('button', { name: t('moneyCoupons.new'), exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: t('moneyCoupons.dialog.newTitle') });
    await dialog.getByLabel(t('moneyCoupons.dialog.code')).fill(couponCode);
    await dialog.getByLabel(t('moneyCoupons.dialog.percent')).fill('50');
    await dialog.getByLabel(t('moneyCoupons.dialog.ends')).fill('2036-12-31');
    await dialog.getByRole('radio', { name: t('moneyCoupons.dialog.whoSchools') }).click();
    await dialog.getByRole('combobox', { name: t('moneyCoupons.dialog.schools') }).click();
    await page.keyboard.type(school.schoolName);
    await page.getByRole('option', { name: school.schoolName }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: t('moneyCoupons.dialog.save'), exact: true }).click();
    await enterCode(page);
    await expect(page.getByRole('row').filter({ hasText: couponCode })).toBeVisible();
  });

  const refundsOnRevenue = async () => {
    await page.goto('/money/revenue');
    const line = page.getByText(t('moneyRevenue.numbers.refunds'), { exact: true }).locator('..');
    await expect(line).toBeVisible();
    return amount((await line.innerText()).replace(t('moneyRevenue.numbers.refunds'), ''));
  };
  const refundsBefore = await refundsOnRevenue();

  await test.step("the school's billing detail refunds the paid seat order with a reason and a code", async () => {
    await page.goto('/subscriptions');
    await page.getByLabel(t('platform.subscriptions.searchLabel')).fill(school.schoolName);
    await page
      .getByRole('button', {
        name: t('platform.subscriptions.viewAction', { name: school.schoolName }),
      })
      .click();
    await page
      .getByRole('dialog')
      // The seat order comes first; the paid SMS package below has its own Refund button.
      .getByRole('button', { name: /^Refund/ })
      .first()
      .click();
    const refund = page.getByRole('dialog').filter({ hasText: t('moneyBilling.refund.reason') });
    await refund
      .getByLabel(t('moneyBilling.refund.reason'))
      .fill('E2E refund of a paid seat order');
    await refund
      .getByRole('button', { name: t('moneyBilling.refund.submit'), exact: true })
      .click();
    await enterCode(page);
    const result = page.getByTestId('refund-result');
    await expect(result).toContainText(t('moneyBilling.refund.instruction'));
  });

  await test.step('Revenue takes the refund off', async () => {
    const after = await refundsOnRevenue();
    expect(after - refundsBefore).toBeCloseTo(seatOrder.amount_paisa / 100, 0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the SMS state page shows what to do first, does not scroll sideways and its buttons work', async ({
    page,
  }) => {
    await page.goto('/money');
    const todo = page.getByRole('heading', { name: t('money.sms.todoTitle') });
    const numbers = page.getByRole('heading', { name: t('money.sms.numbersTitle') });
    await expect(todo).toBeVisible();
    await expect(numbers).toBeVisible();
    // What to do comes before the numbers.
    const [todoBox, numbersBox] = [await todo.boundingBox(), await numbers.boundingBox()];
    expect(todoBox!.y).toBeLessThan(numbersBox!.y);
    // No horizontal scroll.
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    // The record button is reachable and opens a dialog that fits the screen.
    const record = recordButton(page);
    await record.scrollIntoViewIfNeeded();
    await record.tap();
    const dialog = page.getByRole('dialog', { name: t('moneyStock.dialog.title') });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});

test('a 100 % coupon waits for the other owner', async ({ page }) => {
  // A second active owner (rows only: it never signs in here), so the request can wait for them.
  await newOwner('Second Owner');
  await page.goto('/money/coupons');
  await page
    .getByRole('button', { name: t('moneyCoupons.new'), exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: t('moneyCoupons.dialog.newTitle') });
  await dialog.getByLabel(t('moneyCoupons.dialog.code')).fill(`E2E-FREE-${suffix}`);
  await dialog.getByLabel(t('moneyCoupons.dialog.percent')).fill('100');
  await dialog.getByLabel(t('moneyCoupons.dialog.ends')).fill('2036-12-31');
  await expect(dialog.getByText(t('moneyCoupons.dialog.freeWarning'))).toBeVisible();
  await dialog
    .getByRole('button', { name: t('moneyCoupons.dialog.saveFree'), exact: true })
    .click();
  await enterCode(page);
  await expect(page.getByText(t('moneyCoupons.waiting.title'))).toBeVisible();
});
