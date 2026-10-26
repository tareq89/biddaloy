/**
 * [Epic 42 / W11] Results page with a draft exam (nothing processed yet). Demo school, admin card.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step } from '../helpers/nav';

const dir = imgDir('exams-results');

test('exams W11: results draft', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');
  await step('results-draft', async () => {
    await go(page, '/results');
    await page.waitForTimeout(1500);
    await main.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Annual Exam · Class 9' }).first().click();
    await page.waitForTimeout(2000);
    await snap(page, `${dir}/results-02-draft.png`, []);
  });
});
