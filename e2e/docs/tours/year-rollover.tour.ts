/**
 * [69.6.01] Year rollover shots: the Create next year wizard (step 2), the Close year dialog,
 * the Set groups page and the My class "Groups pending" card.
 *
 * Needs the demo school (docs/architecture/22-demo-seed.md). The groups shots also need a draft
 * promotion run with students that have no group yet; if the demo school has none, that step
 * logs SHOT_FAIL and the tour moves on (open a follow-up on Epic 58, never fake data).
 *
 *   GUIDE_LANG=en npx playwright test -c playwright.docs.config.ts --project=en-desktop year-rollover
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const academics = imgDir('academics');
const exams = imgDir('exams-results');

/** Opens the year detail page of the first open year that is not the current one. */
async function openClosableYear(page: Page) {
  await go(page, '/academic-years');
  await page.waitForTimeout(2000);
  const row = page.locator('main tbody tr').filter({ hasNot: page.getByText(/Current|চলমান/) });
  await row.first().getByRole('link').first().click();
  await page.waitForTimeout(2500);
}

test('year rollover: wizard and close dialog', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const admin = await asRole(browser, info, 'admin');
  await admin.setViewportSize({ width: 1440, height: 1000 });

  await step('academic-years-04', async () => {
    await openClosableYear(admin);
    await admin.getByRole('button', { name: tr('academicYears', 'nextYear.fromThisOne') }).click();
    await admin.getByRole('button', { name: tr('academicYears', 'nextYear.next') }).click();
    await admin.waitForTimeout(3000);
    await snap(admin, `${academics}/academic-years-04.png`, []);
  });

  await step('academic-years-05', async () => {
    await openClosableYear(admin);
    await admin.getByRole('button', { name: tr('academicYears', 'closeYear.action') }).click();
    await admin.waitForTimeout(2500);
    await snap(admin, `${academics}/academic-years-05.png`, []);
  });
});

test('year rollover: groups page and My class card', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const admin = await asRole(browser, info, 'admin');
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await step('promotion-03-groups', async () => {
    await go(admin, '/promotions');
    await admin.waitForTimeout(2500);
    await admin.locator('main tbody tr').first().getByRole('link').first().click();
    await admin.waitForTimeout(3000);
    await admin.getByRole('button', { name: tr('promotions', 'groups.setGroupsAction') }).click();
    await admin.waitForTimeout(3000);
    await snap(admin, `${exams}/promotion-03-groups.png`, []);
  });

  const teacher = await asRole(browser, info, 'class-teacher-8a');
  await teacher.setViewportSize({ width: 1440, height: 1000 });
  await step('my-class-05-groups', async () => {
    await go(teacher, '/my-class');
    await teacher.waitForTimeout(3000);
    await teacher.locator('main tbody tr, main a[href^="/my-class/"]').first().click();
    await teacher.waitForTimeout(3500);
    await snap(teacher, `${academics}/my-class-05-groups.png`, []);
  });
});
