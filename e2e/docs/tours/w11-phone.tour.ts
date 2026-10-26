/**
 * [Epic 42 / W11] Phone shots. Demo school.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step } from '../helpers/nav';

test('phone W11: marks list', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  test.setTimeout(900_000);
  const dir = imgDir('exams-results');
  const page = await asRole(browser, info, 'class-teacher-8a');
  await step('marks-phone', async () => {
    await go(page, '/marks');
    await page.waitForTimeout(2000);
    await page.getByRole('main').getByRole('combobox').first().click();
    await page
      .getByRole('option', { name: 'Half-Yearly Exam · Class 6', exact: true })
      .first()
      .click();
    await page.waitForTimeout(2500);
    const row = page
      .getByRole('main')
      .locator('tbody tr, li, article')
      .filter({ hasText: /Not submitted|জমা বাকি/ })
      .first();
    await row.getByRole('link').or(row.getByRole('button')).last().click();
    await page.waitForTimeout(3000);
    await snap(page, `${dir}/marks-entry-05-phone.png`, []);
  });
});
