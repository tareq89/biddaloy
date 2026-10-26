/**
 * [Epic 42 / W8] Screenshots for the Exams & results guide pages
 * (`docs/user-guide/{bn,en}/exams-results`). Demo school, nothing is saved.
 * Signed in as the demo admin (the exam controller card sees the same pages).
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('exams-results');
const f = (name: string) => `${dir}/${name}.png`;
const h1 = (p: Page) => p.getByRole('main').getByRole('heading', { level: 1 });
const rows = (p: Page) => p.getByRole('main').locator('tbody tr');

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: 'serial' });

test('exams-results pages', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');

  await step('exams-list', async () => {
    await go(page, '/exams');
    await settle(page);
    await snap(page, f('exams-01-list'), [
      { target: h1(page) },
      { target: main.getByRole('combobox').first() },
      { target: main.getByRole('button', { name: tr('exams', 'list.addExam') }) },
      { target: rows(page).first() },
    ]);
  });

  await step('exams-dialog', async () => {
    await go(page, '/exams');
    await settle(page);
    await main.getByRole('button', { name: tr('exams', 'list.addExam') }).click();
    await page.waitForTimeout(800);
    await snap(page, f('exams-02-dialog'), [{ target: page.getByRole('dialog') }]);
    await page.keyboard.press('Escape');
  });

  await step('exam-detail', async () => {
    await go(page, '/exams');
    await settle(page);
    await rows(page).first().getByRole('link').first().click();
    await settle(page);
    await snap(page, f('exams-03-detail'), [{ target: h1(page) }, { target: main.getByRole('tab').first() }]);
    const tabs = main.getByRole('tab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await settle(page, 700);
      await snap(page, f(`exams-04-tab${i}`), [{ target: tabs.nth(i) }]);
    }
  });

  await step('templates-list', async () => {
    await go(page, '/exams/templates');
    await settle(page);
    await snap(page, f('exam-templates-01-list'), [{ target: h1(page) }, { target: main.getByRole('button', { name: tr('examTemplates', 'list.add') }) }]);
  });

  await step('template-detail', async () => {
    await go(page, '/exams/templates');
    await settle(page);
    await main.getByRole('link').filter({ hasText: /./ }).nth(0).click();
    await settle(page);
    await snap(page, f('exam-templates-02-detail'), [{ target: h1(page) }, { target: main.getByRole('tab').first() }]);
  });

  await step('marks', async () => {
    await go(page, '/marks');
    await settle(page);
    for (let i = 0; i < 6; i++) {
      await main.getByRole('combobox').first().click();
      await page.getByRole('option').nth(i).click();
      await settle(page);
      if ((await main.locator('a[href*="/marks/"]').count()) > 0) break;
    }
    await snap(page, f('marks-entry-01-list'), [{ target: h1(page) }, { target: main.getByRole('combobox').first() }]);
  });

  await step('analysis', async () => {
    await go(page, '/analysis');
    await settle(page);
    await main.getByRole('combobox').first().click();
    await page.getByRole('option').first().click();
    await settle(page, 2500);
    await snap(page, f('analysis-01-merit'), [
      { target: h1(page) },
      { target: main.getByRole('combobox').first() },
      { target: main.getByRole('tab').first() },
    ]);
    await main.getByRole('tab').nth(1).click();
    await settle(page, 1500);
    await snap(page, f('analysis-02-passfail'), [{ target: main.getByRole('tab').nth(1) }]);
  });

  await step('results', async () => {
    await go(page, '/results');
    await settle(page, 2000);
    await snap(page, f('results-01-processed'), [
      { target: h1(page) },
      { target: main.getByRole('combobox').first() },
      { target: rows(page).first() },
    ]);
    await rows(page).first().click();
    await settle(page, 1500);
    await snap(page, f('results-02-card'), [{ target: h1(page) }]);
  });

  await step('grading', async () => {
    await go(page, '/grading-scales');
    await settle(page);
    await snap(page, f('grading-scales-01-list'), [{ target: h1(page) }]);
    await page.locator('main a[href*="/grading-scales/"]').first().click();
    await settle(page);
    await snap(page, f('grading-scales-02-detail'), [{ target: h1(page) }]);
  });

  await step('seat-plans', async () => {
    await go(page, '/exams/seat-plans');
    await settle(page);
    await snap(page, f('seat-plans-01-list'), [{ target: h1(page) }]);
    await main.getByRole('button', { name: tr('seatPlans', 'list.generateButton') }).click();
    await page.waitForTimeout(800);
    await snap(page, f('seat-plans-02-dialog'), [{ target: page.getByRole('dialog') }]);
    await page.keyboard.press('Escape');
    await go(page, '/exams/seat-plans');
    await settle(page);
    await main.getByRole('link').filter({ hasText: /./ }).nth(0).click();
    await settle(page);
    await snap(page, f('seat-plans-03-plan'), [{ target: h1(page) }]);
  });

  await step('promotions', async () => {
    await go(page, '/promotions');
    await settle(page);
    await snap(page, f('promotion-01-list'), [{ target: h1(page) }]);
    await page.locator('main a[href*="/promotions/"]').first().click();
    await settle(page, 2000);
    await snap(page, f('promotion-02-run'), [{ target: h1(page) }]);
  });
});
