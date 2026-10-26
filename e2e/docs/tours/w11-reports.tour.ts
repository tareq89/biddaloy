/**
 * [Epic 42 / W11] Admin report pages that were still pending: activity log, fee collection,
 * alerts report, application reports, print history. Demo school, admin card.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('reports');
const adminDir = imgDir('administration');

test.describe.configure({ mode: 'serial' });

test('reports W11', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');

  await step('audit-log', async () => {
    await go(page, '/audit-logs');
    await page.waitForTimeout(1500);
    await main.getByRole('combobox').first().click();
    await page
      .getByRole('option', { name: /Updated|হালনাগাদ|আপডেট|পরিবর্তন/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await main.locator('tbody tr').first().getByRole('button').first().click();
    await page.waitForTimeout(1000);
    await snap(page, `${adminDir}/audit-logs-02-rows.png`, []);
  });

  await step('collections', async () => {
    await go(page, '/reports/collections');
    await page.waitForTimeout(2000);
    await snap(page, `${dir}/collections-report-02-month.png`, []);
  });

  await step('alerts-report', async () => {
    await go(page, '/reports/alerts');
    await page.waitForTimeout(2000);
    await snap(page, `${dir}/alerts-report-02-month.png`, []);
  });

  await step('application-reports', async () => {
    await go(page, '/applications/reports');
    await page.waitForTimeout(2000);
    await snap(page, `${dir}/applications-02-reports.png`, []);
  });

  await step('print-history', async () => {
    await go(page, '/reports/printables');
    await page.waitForTimeout(1500);
    if ((await main.locator('tbody tr', { hasText: /Revoked|বাতিল/ }).count()) === 0) {
      await main.locator('tbody tr').first().getByRole('button').last().click();
      await page.waitForTimeout(800);
      await page.getByRole('dialog').getByRole('textbox').fill('Printed for the wrong student');
      await page.waitForTimeout(500);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: tr('printHistory', 'revoke.confirm') })
        .click();
      await page.waitForTimeout(2000);
    }
    await snap(page, `${dir}/printables-02-revoked.png`, []);
  });
});
