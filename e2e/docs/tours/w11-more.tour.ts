/**
 * [Epic 42 / W11] Shots that need arranged data: promotion draft. Demo school, admin card.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('exams-results');
const f = (name: string) => `${dir}/${name}.png`;

test('more W11: promotion draft', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');
  await step('promotion-draft', async () => {
    await go(page, '/promotions');
    await page.waitForTimeout(1500);
    const existing = main
      .locator('tbody tr')
      .filter({ hasText: tr('promotions', 'list.statusDraft') })
      .first();
    if ((await existing.count()) > 0) {
      await existing.getByRole('link').or(existing.getByRole('button')).last().click();
    } else {
      await main
        .getByRole('button', { name: tr('promotions', 'list.newRun') })
        .or(main.getByRole('link', { name: tr('promotions', 'list.newRun') }))
        .first()
        .click();
      await page.waitForTimeout(1500);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: /Class 7 \(2025\)/ }).click();
      await page.waitForTimeout(2500);
      await page.getByRole('button', { name: tr('promotions', 'newRunForm.create') }).click();
    }
    await page.waitForTimeout(4000);
    await snap(page, f('promotion-02-draft'), [
      { target: page.getByRole('status', { name: tr('promotions', 'grid.countsLabel') }) },
      {
        target: page
          .getByText(tr('promotions', 'newRunForm.targetYearLabel'))
          .first()
          .locator('xpath=../../..'),
      },
      { target: page.locator('tbody').first() },
      { target: page.locator('tbody').getByRole('combobox').first() },
      {
        target: page
          .getByRole('button', { name: tr('promotions', 'grid.commit') })
          .locator('xpath=..'),
      },
    ]);
  });
});

test('more W11: seat plan draft', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  await step('seat-plan-draft', async () => {
    await go(page, '/exams/seat-plans');
    await page.waitForTimeout(2000);
    const main = page.getByRole('main');
    const draft = main
      .locator('tbody tr')
      .filter({ hasText: tr('seatPlans', 'status.DRAFT') })
      .first();
    if ((await draft.count()) > 0) {
      await draft.getByRole('link').first().click();
    } else {
      await main
        .getByRole('button', { name: tr('seatPlans', 'list.generateButton') })
        .first()
        .click();
      await page.waitForTimeout(1500);
      const dlg = page.getByRole('dialog');
      await dlg.getByRole('textbox').first().fill('Half-yearly, first week');
      await dlg.getByRole('combobox').first().click();
      await page.getByRole('option', { name: 'First Term Exam · Class 8' }).first().click();
      await page.waitForTimeout(1500);
      const boxes = dlg.getByRole('checkbox');
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      for (let i = 9; i < 13; i++) await boxes.nth(i).check();
      await page.waitForTimeout(500);
      await dlg.getByRole('button', { name: tr('seatPlans', 'generate.submit') }).click();
    }
    await page.waitForTimeout(4000);
    await page
      .waitForFunction(
        () => !document.querySelector('main')?.textContent?.includes('—'),
        undefined,
        { timeout: 15000 },
      )
      .catch(() => undefined);
    await snap(page, f('seat-plans-03-draft'), [
      { target: main.getByRole('heading', { level: 1 }).locator('xpath=..') },
      {
        target: page
          .getByText(tr('seatPlansDetail', 'detail.facts.subjects'))
          .first()
          .locator('xpath=../..'),
      },
      {
        target: page
          .getByRole('button', { name: tr('seatPlansDetail', 'detail.publishButton') })
          .locator('xpath=..'),
      },
      {
        target: page
          .getByText(tr('seatPlansDetail', 'detail.sittingLabel'))
          .first()
          .locator('xpath=..'),
      },
      {
        target: main
          .locator('table')
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]'),
      },
    ]);
  });
});
