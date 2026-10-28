/**
 * [Epic 42 / W13] Admin desktop shots: new survey form (+ publish), ACR criteria step, program page, staff import preview.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

test('admin W13: evaluations, programs, staff import', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const admin = await asRole(browser, info, 'admin');
  await admin.setViewportSize({ width: 1440, height: 1000 });
  const people = imgDir('people');

  await step('evaluations-03', async () => {
    await go(admin, '/staff/evaluations');
    await admin.waitForTimeout(2500);
    await admin.getByRole('tab', { name: tr('evaluations', 'tabs.surveys') }).click();
    await admin.waitForTimeout(1500);
    await admin
      .getByRole('button', { name: tr('evaluations', 'surveys.new') })
      .or(admin.getByRole('link', { name: tr('evaluations', 'surveys.new') }))
      .first()
      .click();
    await admin.waitForTimeout(2000);
    await admin
      .getByLabel(tr('evaluations', 'surveys.form.titleLabel'))
      .fill('Student feedback: Third Term');
    await admin
      .getByRole('combobox', { name: tr('evaluations', 'surveys.form.teacherLabel') })
      .first()
      .click();
    const pick = async (n: number, teacher: string, subject: string) => {
      await admin
        .getByRole('combobox', { name: tr('evaluations', 'surveys.form.teacherLabel') })
        .nth(n)
        .click();
      await admin.keyboard.type(teacher);
      await admin.waitForTimeout(1200);
      await admin.keyboard.press('ArrowDown');
      await admin.keyboard.press('Enter');
      await admin.waitForTimeout(1000);
      await admin
        .getByRole('combobox', { name: tr('evaluations', 'surveys.form.subjectLabel') })
        .nth(n)
        .click();
      await admin.keyboard.type(subject);
      await admin.waitForTimeout(1000);
      await admin.keyboard.press('ArrowDown');
      await admin.keyboard.press('Enter');
      await admin.waitForTimeout(800);
    };
    await pick(0, 'Khadija', 'English');
    await admin.getByRole('button', { name: tr('evaluations', 'surveys.form.addTarget') }).click();
    await admin.waitForTimeout(800);
    await pick(1, 'Alamin', 'Mathematics');
    await admin
      .getByText(tr('evaluations', 'surveys.respondents.STUDENTS'), { exact: true })
      .first()
      .click()
      .catch(() => undefined);
    await admin.waitForTimeout(800);
    await admin.setViewportSize({ width: 1440, height: 1700 });
    await admin.waitForTimeout(800);
    await snap(admin, `${people}/evaluations-03.png`, []);
    await admin.getByRole('button', { name: tr('evaluations', 'surveys.form.saveDraft') }).click();
    await admin.waitForTimeout(2500);
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.waitForTimeout(2500);
  });

  await step('evaluations-02', async () => {
    await go(admin, '/staff/evaluations');
    await admin.waitForTimeout(2500);
    await admin.getByRole('tab', { name: tr('evaluations', 'tabs.acr') }).click();
    await admin.waitForTimeout(2500);
    await admin
      .locator('main tbody tr')
      .filter({ hasText: /In progress|চলমান/ })
      .first()
      .getByRole('link')
      .first()
      .click();
    await admin.waitForTimeout(3000);
    await admin
      .getByRole('button', { name: /Next|পরবর্তী|পরের/ })
      .first()
      .click();
    await admin.waitForTimeout(2000);
    await snap(admin, `${people}/evaluations-02.png`, []);
  });

  await step('programs-03', async () => {
    await go(admin, '/programs');
    await admin.waitForTimeout(2500);
    await admin.locator('main tbody tr').first().getByRole('link').first().click();
    await admin.waitForTimeout(3000);
    await snap(admin, `${people}/programs-03.png`, []);
  });
});
