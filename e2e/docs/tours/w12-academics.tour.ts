/**
 * [Epic 42 / W12] Academics shots: syllabus (topics, phone list, study plans, plan page, page parts).
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('academics');
const f = (name: string) => `${dir}/${name}.png`;

async function pickClassSubject(page: Page) {
  const cls = page.getByRole('combobox', { name: tr('syllabus', 'list.classLabel') });
  const sub = page.getByRole('combobox', { name: tr('syllabus', 'list.subjectLabel') });
  await cls.click();
  await page.getByRole('option', { name: /Class 10|দশম|১০|10/ }).first().click();
  await page.waitForTimeout(1500);
  await sub.click();
  await page.getByRole('option', { name: /Agricultural Education|কৃষি/ }).first().click();
  await page.waitForTimeout(2500);
}

test('academics W12: syllabus desktop', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const teacher = await asRole(browser, info, 'class-teacher-8a');
  await teacher.setViewportSize({ width: 1440, height: 1000 });
  await step('syllabus-01', async () => {
    await go(teacher, '/academics/syllabus');
    await teacher.waitForTimeout(2500);
    await pickClassSubject(teacher);
    await snap(teacher, f('syllabus-01'), []);
  });
  await step('syllabus-04', async () => {
    await go(teacher, '/academics/syllabus');
    await teacher.waitForTimeout(2000);
    await teacher.getByRole('tab', { name: tr('syllabus', 'tabs.plans') }).click();
    await teacher.waitForTimeout(3000);
    await teacher.locator('main tbody tr').first().getByRole('link').first().click();
    await teacher.waitForTimeout(3500);
    await snap(teacher, f('syllabus-04'), []);
  });
  const admin = await asRole(browser, info, 'admin');
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await step('syllabus-03', async () => {
    await go(admin, '/academics/syllabus');
    await admin.waitForTimeout(2000);
    await admin.getByRole('tab', { name: tr('syllabus', 'tabs.plans') }).click();
    await admin.waitForTimeout(3500);
    await snap(admin, f('syllabus-03'), []);
  });
  await step('syllabus-05', async () => {
    await go(admin, '/academics/syllabus');
    await admin.waitForTimeout(2500);
    await pickClassSubject(admin);
    await snap(admin, f('syllabus-05'), []);
  });
});

test('academics W12: syllabus phone', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'class-teacher-8a');
  await step('syllabus-02', async () => {
    await go(page, '/academics/syllabus');
    await page.waitForTimeout(2500);
    await pickClassSubject(page);
    await snap(page, f('syllabus-02'), []);
  });
});
