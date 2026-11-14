import type { Browser, Locator, Page } from '@playwright/test';

import { onlyAttentionRule, patch, post, put } from '../api';
import { newSchool, type NewSchool } from '../fixtures/new-school';
import { deactivateSmsPackages, insertSmsPackage, ownerPaysPackageOrder } from '../fixtures/money';
import { expect, guest, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [100.6.02] The school admin's money job, in the browser: switch the SMS source to SchoolManagerP,
 * buy a package, see the red "SMS almost finished" notice appear and clear, and buy seats with a
 * coupon. English UI. Each test has a fresh school (registered over the API), so nothing here
 * counts on another spec.
 *
 * bKash: nothing in `e2e/` stands in for it, so the buy stops at the redirect (the package pay
 * call is answered by a route stub and the redirect target is asserted); the payment itself is
 * recorded by the owner through the platform API, which runs the same `markPaid`.
 * Values come from the dev seed (`server/src/scripts/seed.money.ts`): coupons E2E-HALF (50 %) and
 * E2E-FREE (100 %).
 */
const t = makeT('en');
test.use({ ...guest, e2eLocale: 'en', actionTimeout: 15_000 });

const BKASH_URL = 'https://pay.example.test/bkash/E2E';

async function schoolOn(browser: Browser, playwright: Parameters<typeof newSchool>[1]) {
  const school = await newSchool(browser, playwright);
  await school.page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
  // Finished, not skipped: an unfinished wizard raises a second alert (the counts below read 1).
  await patch(school.api, school.session, '/onboarding', { seen: true, finished: true });
  await onlyAttentionRule(school.api, school.session, 'sms.low');
  return school;
}

/** A page of the school's own, with the service worker blocked so `page.route()` sees every fetch. */
async function pageWithoutServiceWorker(browser: Browser, school: NewSchool): Promise<Page> {
  const state = await school.context.storageState();
  // One live context per session: two would share (and rotate) the same refresh cookie.
  await school.context.close();
  const context = await browser.newContext({ storageState: state, serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
  return context.newPage();
}

/** Stub the package pay call and the bKash page it points at. */
async function stubBkash(page: Page): Promise<void> {
  await page.route('**/api/v1/sms-bundles/orders/*/pay/bkash', (route) =>
    route.fulfill({ status: 200, json: { bkash_url: BKASH_URL } }),
  );
  await page.route(`${BKASH_URL}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>bKash</h1>' }),
  );
}

test('a school on its own SMS company uses the offer to switch to SchoolManagerP, buys a package and reads the lot', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await schoolOn(browser, playwright);
  const pkg = await insertSmsPackage('E2E journey 100', 100, 30000);
  let orderIdOf = '';
  const page = await pageWithoutServiceWorker(browser, school);
  try {
    await stubBkash(page);
    await page.goto('/settings?section=communication');
    const card = page.getByRole('group', { name: pkg.name });
    const buy = card.getByRole('button', { name: t('smsBundles.packages.buy'), exact: true });

    await test.step('the packages, the unmasked note and the switch offer are on the page', async () => {
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(t('smsBundles.unmaskedNote'))).toBeVisible();
      await expect(page.getByText(t('smsBundles.source.body'))).toBeVisible();
    });

    await test.step('the offer switches the school to SchoolManagerP SMS', async () => {
      await page.getByRole('button', { name: t('smsBundles.source.switch'), exact: true }).click();
      // The offer is gone once the source is SchoolManagerP.
      await expect(page.getByText(t('smsBundles.source.body'))).toHaveCount(0);
    });

    await test.step('Buy opens the dialog; Buy with bKash creates the order and goes to bKash', async () => {
      await buy.click();
      await expect(page.getByRole('dialog', { name: /Buy 100 SMS/ })).toBeVisible();
      const created = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/sms-bundles/orders') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: t('smsBundles.buy.submit'), exact: true }).click();
      orderIdOf = ((await (await created).json()) as { id: string }).id;
      await page.waitForURL(`${BKASH_URL}**`);
    });

    await test.step('the owner records the payment; the lot, its end date and the history show', async () => {
      await ownerPaysPackageOrder(playwright, orderIdOf);
      await page.goto('/settings?section=communication');
      await expect(page.getByText(t('smsBundles.lots.left', { n: 100 }))).toBeVisible({
        timeout: 15_000,
      });
      // The lot's end date is a real date (about 30 days out), not "No end date".
      await expect(page.getByText(t('smsBundles.lots.noExpiry'))).toHaveCount(0);
      await expect(page.getByText(/^\d{1,2}(st|nd|rd|th) \w+, \d{4}$/).first()).toBeVisible();
      await expect(
        page.getByText(t('smsBundles.history.kind.PURCHASE'), { exact: true }),
      ).toHaveCount(1);
    });
  } finally {
    await deactivateSmsPackages(pkg.id);
    await page.context().close();
    await school.api.dispose();
  }
});

test('the whole buy, switch included, works with the keyboard alone', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await schoolOn(browser, playwright);
  const pkg = await insertSmsPackage('E2E keyboard 100', 100, 30000);
  const page = await pageWithoutServiceWorker(browser, school);
  try {
    await stubBkash(page);
    await page.goto('/settings?section=communication');
    const buy = page
      .getByRole('group', { name: pkg.name })
      .getByRole('button', { name: t('smsBundles.packages.buy'), exact: true });
    await expect(buy).toBeVisible({ timeout: 15_000 });

    /** Tabs until `target` has focus (a bounded poll: the dialog's tab order may grow). */
    const tabTo = async (target: Locator) => {
      await expect(async () => {
        if (!(await target.evaluate((el) => el === document.activeElement))) {
          await page.keyboard.press('Tab');
        }
        await expect(target).toBeFocused({ timeout: 500 });
      }).toPass({ timeout: 10_000 });
    };

    // Focus the button once (a keyboard user Tabs to it), then everything else is keys.
    await buy.focus();
    await page.keyboard.press('Enter');
    // The school is on its own SMS company: Buy offers the switch first.
    const switchAndBuy = page.getByRole('button', {
      name: t('smsBundles.source.switchAndBuy'),
      exact: true,
    });
    await expect(switchAndBuy).toBeVisible();
    // Escape closes the offer. (Focus is not returned to Buy today: the dialog opens from state,
    // not from a trigger; tracked as a follow-up, so it is not asserted here.)
    await page.keyboard.press('Escape');
    await expect(switchAndBuy).toBeHidden();
    await buy.focus();
    await page.keyboard.press('Enter');
    await tabTo(switchAndBuy);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Buy 100 SMS/ });
    await expect(dialog).toBeVisible();
    await tabTo(dialog.getByRole('button', { name: t('smsBundles.buy.submit'), exact: true }));
    await page.keyboard.press('Enter');
    // The submit creates the order and goes straight to bKash.
    await page.waitForURL(`${BKASH_URL}**`);
  } finally {
    await deactivateSmsPackages(pkg.id);
    await page.context().close();
    await school.api.dispose();
  }
});

test('almost-finished SMS raises the red notice; its link opens the SMS page; buying more clears it', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(100_000);
  const school = await schoolOn(browser, playwright);
  await put(school.api, school.session, '/communications/sms-source', { source: 'SCHOOLMANAGERP' });
  // 100 SMS left is the "almost finished" line (at or under 100), so one small package raises it.
  const small = await insertSmsPackage('E2E small 100', 100, 30000);
  const big = await insertSmsPackage('E2E big 1000', 1000, 250000);
  const { page } = school;
  const bar = page
    .getByRole('status')
    .filter({ hasText: t('attention.bar.critical_one', { n: 1 }) });

  const buyAndPay = async (packageId: string) => {
    const order = await post<{ id: string }>(school.api, school.session, '/sms-bundles/orders', {
      package_id: packageId,
      idempotency_key: crypto.randomUUID(),
    });
    await ownerPaysPackageOrder(playwright, order.id);
  };
  const barIsShown = async () => {
    await page.goto('/dashboard');
    // Judge the bar only once the page is up, so a slow load never reads as "gone".
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    return bar.waitFor({ timeout: 3_000 }).then(
      () => 1,
      () => 0,
    );
  };

  try {
    await test.step('100 SMS left raises one urgent notice in the bar', async () => {
      await buyAndPay(small.id);
      // The payment asks the engine for a recheck; it lands within seconds.
      await expect.poll(barIsShown, { timeout: 45_000, intervals: [2_000] }).toBeGreaterThan(0);
    });

    await test.step('the notice opens, and its Buy SMS link lands on the SMS page with the buy dialog', async () => {
      // The bar's status text sits inside the button that opens the list.
      await page.getByRole('button').filter({ has: bar }).click();
      await page.getByRole('button', { name: 'Buy SMS', exact: true }).click();
      await expect(page).toHaveURL(/\/settings\?.*section=communication/);
      await expect(page.getByRole('dialog', { name: /Buy 100 SMS/ })).toBeVisible({
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');
      await expect(page.getByText(t('smsBundles.lots.left', { n: 100 }))).toBeVisible();
    });

    await test.step('buying 1,000 more lifts the number and the notice goes', async () => {
      await buyAndPay(big.id);
      await expect.poll(barIsShown, { timeout: 45_000, intervals: [2_000] }).toBe(0);
      await page.goto('/notifications?tab=active');
      await expect(
        page.getByRole('heading', { name: t('attention.worklist.emptyActiveTitle') }),
      ).toBeVisible();
    });
  } finally {
    await deactivateSmsPackages(small.id, big.id);
    await school.context.close();
    await school.api.dispose();
  }
});

test('seats with a coupon: a wrong code gets one sentence, a right code a new price, a 100 % code is free', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await schoolOn(browser, playwright);
  const { page } = school;
  const amount = (s: string | null) => Number((s ?? '').replace(/[^0-9.]/g, ''));
  try {
    await page.goto('/settings?section=billing');
    await page
      .getByRole('button', { name: t('billing.buy.action'), exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(t('billing.buy.seats')).fill('10');
    await dialog.getByLabel(t('billing.buy.months')).fill('2');
    await dialog.getByRole('button', { name: t('billing.coupon.toggle') }).click();

    await test.step('a wrong code shows one sentence', async () => {
      await dialog.getByLabel(t('billing.coupon.code')).fill('E2E-NOPE');
      await dialog.getByRole('button', { name: t('billing.coupon.apply'), exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: t('billing.coupon.invalid') }),
      ).toBeVisible();
    });

    await test.step('E2E-HALF shows the list price, the discount and a total at half', async () => {
      await dialog.getByLabel(t('billing.coupon.code')).fill('E2E-HALF');
      await dialog.getByRole('button', { name: t('billing.coupon.apply'), exact: true }).click();
      const list = dialog.getByText(new RegExp(`^${t('billing.coupon.list')}:`));
      const total = dialog.getByText(new RegExp(`^${t('billing.coupon.newTotal')}:`));
      await expect(total).toBeVisible();
      const listAmount = amount(await list.textContent());
      expect(listAmount).toBeGreaterThan(0);
      expect(amount(await total.textContent())).toBeCloseTo(listAmount / 2, 2);
      await dialog.getByRole('button', { name: t('billing.buy.submit'), exact: true }).click();
      await expect(dialog.getByText(t('billing.buy.createdTitle'))).toBeVisible();
      await dialog
        .getByRole('button', { name: t('billing.buy.close'), exact: true })
        .first()
        .click();
    });

    await test.step('E2E-FREE gives the seats at once, with a receipt and no bKash redirect', async () => {
      await page
        .getByRole('button', { name: t('billing.buy.action'), exact: true })
        .first()
        .click();
      await dialog.getByLabel(t('billing.buy.seats')).fill('10');
      await dialog.getByLabel(t('billing.buy.months')).fill('1');
      await dialog.getByRole('button', { name: t('billing.coupon.toggle') }).click();
      await dialog.getByLabel(t('billing.coupon.code')).fill('E2E-FREE');
      await dialog.getByRole('button', { name: t('billing.coupon.apply'), exact: true }).click();
      await dialog
        .getByRole('button', { name: t('billing.coupon.submitFree'), exact: true })
        .click();
      await expect(dialog.getByText(t('billing.coupon.freeDone'))).toBeVisible();
      await expect(dialog.getByRole('button', { name: t('billing.coupon.receipt') })).toBeVisible();
      await expect(dialog.getByRole('button', { name: t('billing.buy.payBkash') })).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings/);
    });
  } finally {
    await school.context.close();
    await school.api.dispose();
  }
});
