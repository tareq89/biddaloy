/**
 * [Epic 42 / W11] The pending PNG shots that a DEMO_MODE server can take: dashboard saved,
 * committee meeting report, the SVG import window, a teacher with two sections, a Reported
 * period card, and the admission walk-in form with its saved message (two shots).
 *
 *   GUIDE_LANG=en npx playwright test -c playwright.docs.config.ts --project=en-desktop pending-demo
 *
 * Local data this expects (throwaway demo DB only): the class teacher of 8-A is also
 * ASSISTANT_CLASS_TEACHER of 8-B (one SQL insert into teacher_class_sections).
 */
import { expect, test } from '@playwright/test';

import { guideLang, imgDir, loginAs, prepare, requireEnv, shoot } from '../helpers/capture';
import { re, tr } from '../helpers/nav';

const lang = guideLang();

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="86mm" height="54mm" viewBox="0 0 86 54">
  <rect width="86" height="54" fill="#f3f6ff"/>
  <rect x="4" y="4" width="78" height="10" fill="#2b3a8f"/>
  <text x="8" y="26" font-family="Biddaloy Sans" font-size="4">{{student.name}}</text>
  <text x="8" y="34" font-family="Biddaloy Sans" font-size="3">{{student.class}}</text>
  <text x="8" y="42" font-family="Kalpurush" font-size="3">{{student.roll}}</text>
</svg>`;

test('admin: dashboard saved, SVG import window', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  page.setDefaultTimeout(20_000);
  await prepare(page);
  await loginAs(page, 'admin');
  const dir = imgDir('dashboard');

  await page.goto('/dashboard?customize=1');
  await expect(page.getByText(tr('dashboard', 'customise.badge'))).toBeVisible();
  await page
    .getByRole('button', { name: re(tr('dashboard', 'customise.moveDown')) })
    .first()
    .click();
  await page.getByRole('button', { name: tr('dashboard', 'customise.save') }).click();
  const saved = page.getByText(tr('dashboard', 'customise.saved')).first();
  await expect(saved).toBeVisible();
  await shoot(page, `${dir}/dashboard-04-saved.png`, [{ target: saved }], { keepToasts: true });

  await page.goto(
    `/print-templates/${requireEnv('GUIDE_TEMPLATE_ID', 'the id of the demo ID-card template')}/edit`,
  );
  await page.getByRole('button', { name: tr('printEditor', 'tabs.assets'), exact: true }).click();
  await page.getByRole('button', { name: tr('printEditor', 'svgImport.open') }).click();
  const dialog = page.getByRole('dialog', { name: tr('printEditor', 'svgImport.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'id-card.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) });
  const table = dialog.getByRole('table');
  await expect(table).toBeVisible();
  await shoot(page, `${imgDir('administration/print-templates')}/designer-guide-01.png`, [
    { target: table },
    { target: dialog.getByText(tr('printEditor', 'svgImport.statusFont')).first() },
    { target: dialog.getByRole('button', { name: tr('printEditor', 'svgImport.import') }) },
  ]);
});

test('committee: monthly meeting report', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'committee');
  await page.goto('/print/committee-report');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${imgDir('dashboard')}/dashboard-05-meeting-report.png`);
});

test('teacher: two sections in My class, a Reported period', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const dir = imgDir('academics');

  await page.goto('/my-class');
  const classTeacher = page
    .getByText(tr('myClass', 'roles.CLASS_TEACHER'), { exact: true })
    .first();
  const assistant = page
    .getByText(tr('myClass', 'roles.ASSISTANT_CLASS_TEACHER'), { exact: true })
    .first();
  await expect(assistant).toBeVisible();
  await shoot(page, `${dir}/my-class-01.png`, [{ target: classTeacher }, { target: assistant }]);

  await page.goto('/routines/my');
  await expect(page.getByRole('main')).toBeVisible();
  // Each period card is a radiogroup: Taught / Partly / Not taught.
  const taught = page.getByRole('radio', {
    name: tr('routines', 'marking.status.taught'),
    exact: true,
  });
  if (
    await taught
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await taught.first().check({ force: true });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  const reported = page
    .getByText(tr('routines', 'marking.badge.reported'), { exact: true })
    .first();
  await expect(reported).toBeVisible({ timeout: 15_000 });
  const card = reported.locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
  await shoot(page, `${dir}/my-routine-02.png`, [{ target: card }]);
});

test('admin: walk-in application form and its saved message', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'admin');
  const ns = 'admission-desk';
  const dir = imgDir('people');
  const name = lang === 'bn' ? 'তানিশা রহমান' : 'Tanisha Rahman';

  await page.goto('/admissions/applicants/new');
  await expect(page.getByRole('heading', { level: 1, name: tr(ns, 'clerk.title') })).toBeVisible();
  // The first open round; its own boxes appear below.
  await page.locator('#clerk-round').click();
  await page.getByRole('option').first().click();
  const form = page.locator('#clerk-name');
  await expect(form).toBeVisible();
  await shoot(page, `${dir}/admission-clerk-entry-01.png`, [
    { target: page.locator('#clerk-round') },
    { target: form },
    { target: page.getByRole('button', { name: tr(ns, 'clerk.save') }) },
  ]);

  await form.fill(name);
  await page
    .locator('#clerk-guardian_name')
    .fill(lang === 'bn' ? 'মিজানুর রহমান' : 'Mizanur Rahman');
  await page.locator('#clerk-guardian_phone').fill('01700000123');
  const docsLater = page.locator('#clerk-docs-later');
  if (await docsLater.isVisible().catch(() => false)) await docsLater.click();
  await page.getByRole('button', { name: tr(ns, 'clerk.save') }).click();
  const saved = page.getByText(re(tr(ns, 'clerk.done'))).first();
  await expect(saved).toBeVisible();
  await shoot(page, `${dir}/admission-clerk-entry-02.png`, [{ target: saved }]);
});
