/**
 * [Epic 42 / W11] The pending PNG shots that a DEMO_MODE server can take: dashboard saved,
 * committee meeting report, the SVG import window, a teacher with two sections, a Reported
 * period card, and the public admission form on a guardian's phone (three shots).
 *
 *   GUIDE_LANG=en npx playwright test -c playwright.docs.config.ts --project=en-desktop pending-demo
 *
 * Local data this expects (throwaway demo DB only): the class teacher of 8-A is also
 * ASSISTANT_CLASS_TEACHER of 8-B (one SQL insert into teacher_class_sections).
 */
import { devices, expect, test, type Page } from '@playwright/test';

import { guideLang, imgDir, loginAs, prepare, requireEnv, shoot } from '../helpers/capture';
import { re, tr } from '../helpers/nav';

const lang = guideLang();
const SLUG = process.env.GUIDE_SCHOOL_SLUG ?? 'bmsc-high';

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

test('guest on a phone: form top, submitted page, status card', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    locale: lang,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page: Page = await context.newPage();
  await prepare(page);
  const ns = 'admission-public';
  const dir = imgDir('people');
  const name = lang === 'bn' ? 'তানিশা রহমান' : 'Tanisha Rahman';
  const phone = '01700000123';

  await page.goto(`/admission/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: tr(ns, 'form.title') })).toBeVisible();
  const facts = page
    .getByText(tr(ns, 'form.intakeFacts.round'))
    .locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
  await expect(facts).toBeVisible();
  await shoot(page, `${dir}/admission-intakes-03.png`, [{ target: facts }]);

  await page.getByLabel(tr(ns, 'form.fields.applicantName')).fill(name);
  await page
    .locator('button', { hasText: tr('common', 'date.pick') })
    .first()
    .click();
  await page.getByRole('button', { name: tr('common', 'date.chooseMonthYear') }).click();
  const back = page.getByRole('button', { name: tr('common', 'date.previousYear') });
  for (let y = new Date().getFullYear(); y > 2015; y--) await back.click();
  await page
    .getByRole('button', { name: /^Mar|মার্চ/ })
    .first()
    .click();
  await page.locator('[role="grid"] [data-date="2015-03-10"]').click();
  await page.getByRole('combobox', { name: tr(ns, 'form.fields.gender') }).click();
  await page.getByRole('option', { name: tr(ns, 'form.fields.genderOptions.FEMALE') }).click();
  await page
    .getByLabel(tr(ns, 'form.fields.guardianName'))
    .fill(lang === 'bn' ? 'মিজানুর রহমান' : 'Mizanur Rahman');
  await page.getByLabel(tr(ns, 'form.fields.guardianPhone')).fill(phone);
  // The seeded round asks for a photo and a birth certificate: two tiny JPEGs (magic bytes only).
  const jpeg = { mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
  for (const [doc, file] of [
    ['PHOTO', 'photo.jpg'],
    ['BIRTH_CERTIFICATE', 'birth-certificate.jpg'],
  ] as const) {
    const input = page.getByLabel(tr(ns, `form.documents.${doc}`), { exact: true });
    if (await input.count()) await input.setInputFiles({ name: file, ...jpeg });
  }
  await page.getByRole('button', { name: tr(ns, 'form.submit') }).click();
  const ref = page.getByTestId('reference-number');
  await expect(ref).toBeVisible();
  await shoot(page, `${dir}/admission-intakes-04.png`, [
    { target: ref },
    { target: page.getByRole('button', { name: tr(ns, 'confirmation.copy') }) },
  ]);
  const reference = ((await ref.textContent()) ?? '').trim();

  await page.goto(`/admission/${SLUG}/status`);
  await page.getByLabel(tr(ns, 'status.fields.referenceNumber')).fill(reference);
  await page.getByLabel(tr(ns, 'status.fields.guardianPhone')).fill(phone);
  await page.getByRole('button', { name: tr(ns, 'status.submit') }).click();
  const badge = page.getByText(tr(ns, 'status.badges.PENDING'), { exact: true }).first();
  await expect(badge).toBeVisible();
  await shoot(page, `${dir}/admission-intakes-05.png`, [
    { target: badge },
    { target: page.getByText(tr(ns, 'status.next.PENDING')).first() },
  ]);
  await context.close();
});
