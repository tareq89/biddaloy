/**
 * [Epic 42 / W8] Screenshots for the Finance guide pages (`docs/user-guide/{bn,en}/finance`).
 * Demo school only. Dialogs and forms are filled and closed, not saved, except the
 * setup steps that give the lists something to show (one reversed payment, one manual fine).
 * Long full-screen forms are shot on a tall viewport so every numbered part is visible.
 */
import { test, type Locator, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('finance');
const f = (name: string) => `${dir}/${name}.png`;
const TALL = { width: 1440, height: 1500 };
const XTALL = { width: 1440, height: 2400 };
const NORMAL = { width: 1440, height: 900 };

const h1 = (p: Page) => p.getByRole('main').getByRole('heading', { level: 1 });
const rows = (p: Page) => p.getByRole('main').locator('tbody tr');
const th = (p: Page, i: number) => p.getByRole('main').locator('thead th').nth(i);
const cards = (p: Page) => p.locator('form div.rounded-lg.border');
const saveBar = (p: Page) => p.locator('header ~ div button, button').last();

async function pick(page: Page, combo: Locator, n = 0) {
  await combo.click();
  await page.getByRole('option').nth(n).click();
  await page.waitForTimeout(300);
}

async function tall<T>(page: Page, fn: () => Promise<T>, size = TALL): Promise<T> {
  await page.setViewportSize(size);
  await page.waitForTimeout(400);
  try {
    return await fn();
  } finally {
    await page.setViewportSize(NORMAL);
  }
}

/** `snap` clipped to the callout targets (plus a margin), so text stays legible at page width. */
async function snapTight(page: Page, file: string, callouts: { target: Locator }[], skipLast = false): Promise<void> {
  const boxes = (await Promise.all((skipLast ? callouts.slice(0, -1) : callouts).map((c) => c.target.boundingBox()))).filter((b) => b !== null);
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 36);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 36);
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + 36;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + 36;
  await snap(page, file, callouts, { region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}

test.describe.configure({ mode: 'serial' });

test('finance: setup, then accountant pages', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');

  // A reversed payment needs the step-up code, which the demo disables (DEMO_DISABLED),
  // so the "Reversed" list image (payments page) stays pending.
  // ---- admin pages ----
  await step('fee-structures-list', async () => {
    await go(page, '/fee-structures');
    await snap(page, f('fee-structures-02-list'), [
      { target: h1(page) },
      { target: main.getByRole('textbox').first() },
      { target: main.locator('table') },
    ]);
  });

  await step('fee-structures-dialog', async () => {
    await go(page, '/fee-structures');
    await main.getByRole('button', { name: tr('feeStructures', 'list.addStructure') }).click();
    await page.waitForTimeout(600);
    await tall(page, async () => {
      const dlg = page.getByRole('dialog');
      await dlg.getByRole('textbox').first().fill('Monthly tuition');
      await dlg.getByRole('textbox').nth(1).fill('1500');
      await pick(page, dlg.getByRole('combobox').nth(1), 0);
      await pick(page, dlg.getByRole('combobox').nth(2), 0);
      await snapTight(page, f('fee-structures-01-dialog'), [
        { target: dlg.getByRole('textbox').first() },
        { target: dlg.getByRole('combobox').first() },
        { target: dlg.getByRole('textbox').nth(1) },
        { target: dlg.getByRole('combobox').nth(1) },
        { target: dlg.getByRole('combobox').nth(2) },
        { target: dlg.getByRole('combobox').nth(3) },
        { target: dlg.getByRole('button').last() },
      ]);
    });
    await page.keyboard.press('Escape');
  });

  await step('fine-rules', async () => {
    await go(page, '/fees/fines/rules');
    await snap(page, f('fines-02-rules'), [
      { target: main.getByRole('button').nth(2) },
      { target: rows(page).first() },
      { target: rows(page).nth(1) },
    ]);
  });

  await step('payment-detail', async () => {
    await go(page, '/payments');
    await rows(page).first().getByRole('link').first().click();
    await page.waitForTimeout(1500);
    const item = main.getByRole('button', { name: /more|আরও|\.\.\./i }).last();
    await snap(page, f('payments-01-detail'), [
      { target: main.locator('h1') },
      { target: main.locator('table').first() },
      { target: main.getByRole('button', { name: tr('payments', 'detail.printReceipt') }) },
      { target: item },
    ]);
    await page.keyboard.press('Escape');
  });

  await step('schedule-view', async () => {
    await go(page, '/fees/schedules');
    await rows(page).first().getByRole('link').first().click();
    await page.waitForTimeout(1500);
    await snap(page, f('recurring-schedules-02-rule'), [
      { target: h1(page) },
      { target: page.getByText(tr('fees', 'schedules.columnNextRun'), { exact: true }) },
      { target: main.locator('div.rounded-lg.border').first() },
      { target: page.getByRole('heading', { name: tr('fees', 'schedules.detail.runHistoryTitle') }) },
    ]);
  });

  // ---- accountant pages (same admin session: the pages are the same) ----
  await step('dues-01', async () => {
    await go(page, '/fees/dues');
    await rows(page).first().getByRole('button').first().click();
    await page.waitForTimeout(800);
    await snap(page, f('dues-01'), [
      { target: main.getByRole('textbox').first() },
      { target: th(page, 4) },
      { target: main.locator('tbody tr').nth(1) },
      { target: main.locator('tbody tr').first().locator('td').last() },
    ]);
  });

  await step('dues-02', async () => {
    await go(page, '/fees/dues');
    await main.locator('tbody [role=checkbox]').nth(0).click();
    await main.locator('tbody [role=checkbox]').nth(1).click();
    await page.waitForTimeout(500);
    await snap(page, f('dues-02'), [
      { target: h1(page) },
      { target: main.getByRole('textbox').first() },
      { target: rows(page).first() },
      { target: main.getByRole('button', { name: tr('fees', 'dues.exportCsv') }) },
    ]);
  });

  await step('invoices-list', async () => {
    await go(page, '/invoices');
    await snap(page, f('invoices-02-list'), [
      { target: h1(page) },
      { target: main.getByRole('textbox').first() },
      { target: rows(page).first() },
    ]);
  });

  await step('invoice-detail', async () => {
    await go(page, '/invoices');
    await rows(page).first().getByRole('link').first().click();
    await page.waitForTimeout(1500);
    await tall(page, () =>
      snapTight(page, f('invoices-01-detail'), [
        { target: h1(page) },
        { target: main.locator('table').first() },
      ]),
    );
  });

  await step('record-payment-01', async () => {
    await go(page, '/payments/record');
    await page.getByRole('textbox').first().fill('Nishat');
    await page.waitForTimeout(1500);
    await page.getByText('Nishat Sultana').first().click();
    await page.waitForTimeout(1800);
    await tall(page, async () => {
      const amount = page.getByRole('textbox').nth(1);
      await amount.fill('1000');
      await page.waitForTimeout(800);
      await snapTight(page, f('record-payment-01'), [
        { target: page.locator('h2').nth(0) },
        { target: amount },
        { target: page.locator('h2').nth(1) },
        { target: page.locator('h2').nth(2) },
        { target: page.getByRole('button').last() },
      ], true);
    }, XTALL);
  });

  await step('generations-list', async () => {
    await go(page, '/fees/generate');
    await snap(page, f('generate-fees-02-list'), [{ target: h1(page) }, { target: rows(page).first() }]);
  });

  await step('generate-01', async () => {
    await go(page, '/fees/generate?generate=1');
    await page.waitForTimeout(1000);
    await tall(page, () => snapTight(page, f('generate-fees-01'), [{ target: cards(page).first() }, { target: cards(page).nth(1) }]));
  });

  await step('fines-list', async () => {
    await go(page, '/fees/fines');
    await snap(page, f('fines-03-list'), [{ target: h1(page) }, { target: main.locator('div.rounded-lg.border').first() }, { target: rows(page).first() }]);
  });

  await step('log-fine', async () => {
    await go(page, '/fees/fines');
    await main.getByRole('button', { name: tr('fines', 'logForm.title') }).click();
    await page.waitForTimeout(800);
    await snap(page, f('fines-01-log'), [{ target: page.getByRole('dialog') }]);
    await page.keyboard.press('Escape');
  });

  await step('schedule-new', async () => {
    await go(page, '/fees/schedules?new=1');
    await page.waitForTimeout(800);
    await tall(page, () => snapTight(page, f('recurring-schedules-01-new'), [{ target: cards(page).first() }, { target: cards(page).nth(1) }, { target: cards(page).nth(2) }, { target: cards(page).nth(3) }]));
  });
  void saveBar;
});
