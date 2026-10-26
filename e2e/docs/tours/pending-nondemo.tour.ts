/**
 * [Epic 42 / W11] Pending PNG shots that need the API started WITHOUT DEMO_MODE
 * (bulk uploads and calendar import are on the demo deny list), still on the throwaway
 * seed:demo database. `GUIDE_PASSWORD` makes loginAs use the password form.
 *
 *   GUIDE_LANG=en GUIDE_PASSWORD=... npx playwright test -c playwright.docs.config.ts --project=en-desktop pending-nondemo
 *
 * Shots: staff-import-02 (preview), calendar-03 (import review), homework-05 (rows with
 * problems), setup-05 (students import check), and on a brand-new school created through
 * /register: create-school-02 (code step), create-school-03 (wizard doors),
 * curriculum-preset-01/02 and setup-03 (Ready-made curriculum page).
 */
import { expect, test, type Page } from '@playwright/test';

import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';
import { re, tr } from '../helpers/nav';

const lang = guideLang();
const n = Date.now().toString().slice(-6);
const csvFile = (name: string, csv: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(csv),
});

test('admin: four import previews', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  page.setDefaultTimeout(20_000);
  await prepare(page);
  await loginAs(page, 'admin');

  // Staff import: the check result before confirming.
  await page.goto('/staff/import');
  await page
    .getByLabel(tr('bulkImport', 'chooseFile'))
    .setInputFiles(
      csvFile(
        'staff.csv',
        [
          'name,mobile,email,role,designation',
          `Rokeya Sultana,,rokeya.${n}@example.com,Teacher,Assistant Teacher`,
          `Imran Hossain,0171${n}0,imran.${n}@example.com,Accountant,`,
          `Shirin Akhter,,shirin.${n}@example.com,Office staff,`,
        ].join('\n'),
      ),
    );
  const willAdd = page.getByText(/will be added|যোগ হবে/).first();
  await expect(willAdd).toBeVisible();
  const invite = page.getByRole('checkbox', { name: tr('staffImport', 'sendInvitations') });
  const confirm = page.getByRole('button', { name: tr('bulkImport', 'confirm'), exact: true });
  await confirm.scrollIntoViewIfNeeded();
  await shoot(page, `${imgDir('people')}/staff-import-02.png`, [
    { target: willAdd.locator('..') },
    { target: invite },
    { target: page.getByRole('table') },
    { target: page.getByText(re(tr('bulkImport', 'expiresIn'))).first() },
  ]);

  // Calendar import: step 2, the review.
  await page.goto('/calendar/import');
  await page
    .getByLabel(tr('calendarImport', 'step1.chooseFile'))
    .setInputFiles(
      csvFile(
        'calendar.csv',
        [
          'type,name,start_date,end_date,start_time,end_time,counts_as_working_day,audience,classes,description',
          'HOLIDAY,Victory Day,2026-12-16,2026-12-16,,,FALSE,ALL,,',
          'EVENT,Annual prize giving,2026-12-20,2026-12-20,10:00,13:00,TRUE,ALL,,',
          'EVENT,Parent-teacher meeting,2026-12-23,2026-12-23,,,TRUE,ALL,,',
          'EVENT,Winter break starts,2026-12-32,2026-12-32,,,FALSE,ALL,,',
        ].join('\n'),
      ),
    );
  await page.getByRole('button', { name: tr('calendarImport', 'step1.check') }).click();
  await expect(page.getByText(tr('calendarImport', 'step2.title'))).toBeVisible();
  const counts = page
    .getByText(/new$|নতুন$/)
    .first()
    .locator('..');
  await shoot(page, `${imgDir('people')}/calendar-03.png`, [
    { target: counts },
    { target: page.getByRole('table') },
    { target: page.getByText(tr('calendarImport', 'step2.rulesTitle')).locator('..') },
  ]);

  // Homework import: the Rows with problems table.
  await page.goto('/academics/homework/import');
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      csvFile(
        'homework.csv',
        [
          'class,section,subject,assigned_date,due_date,description',
          'Class 8,A,Bangla,2026-10-26,2026-10-29,Read chapter 4',
          'Class 8,A,Mathematics,2026-10-26,2026-10-20,Exercise 3.2',
          'Class 14,A,Bangla,2026-10-26,2026-10-30,Essay',
          'Class 8,B,Astronomy,2026-10-26,2026-10-30,Star chart',
        ].join('\n'),
      ),
    );
  const problems = page.getByRole('heading', { name: tr('bulkImport', 'errors.title') });
  await expect(problems).toBeVisible();
  await problems.scrollIntoViewIfNeeded();
  await shoot(page, `${imgDir('academics')}/homework-05.png`, [
    // The problems table comes before the Preview table.
    { target: page.getByRole('table').first() },
    { target: page.getByRole('button', { name: tr('bulkImport', 'errors.exportCsv') }) },
  ]);

  // Students: the Import students button, then the check result.
  await page.goto('/students');
  const importButton = page
    .getByRole('main')
    .getByRole('link', { name: /Import|আমদানি|ইমপোর্ট/ })
    .first();
  await expect(importButton).toBeVisible();
  await shoot(page, `${imgDir('admin')}/setup-05-import-students.png`, [{ target: importButton }]);
  await page.goto('/students/import');
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      csvFile(
        'students.csv',
        [
          'student_name,class,section,roll,registration_number,guardian1_name,guardian1_phone,guardian1_email,guardian2_name,guardian2_phone,guardian2_email,home_address,preferred_communication',
          `Arifa Khatun,Class 6,A,61,2026-06${n.slice(-3)},Abdul Karim,0171${n}1,,,,,Mirpur,SMS`,
          `Sakib Hasan,Class 6,A,62,2026-07${n.slice(-3)},Rahima Begum,0171${n}2,,,,,Uttara,SMS`,
        ].join('\n'),
      ),
    );
  const willCreate = page.getByText(/will be created|তৈরি হবে/).first();
  await expect(willCreate).toBeVisible();
  await willCreate.scrollIntoViewIfNeeded();
  await shoot(page, `${imgDir('admin')}/setup-05b-import-check.png`, [
    { target: willCreate.locator('..') },
  ]);
});

test('a new school: code step, wizard doors, ready-made curriculum', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  const context = await browser.newContext({ ...info.project.use });
  const page: Page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await prepare(page);
  const reg = 'register';
  const admin = imgDir('admin');

  await page.goto('/register');
  await expect(page.getByRole('heading', { level: 1, name: tr(reg, 'title') })).toBeVisible();
  await page
    .getByLabel(tr(reg, 'fields.adminName'))
    .fill(lang === 'bn' ? 'ফারহানা হক' : 'Farhana Haque');
  await page.locator('#register-phone').fill(`0171${n}9`);
  await page
    .getByLabel(tr(reg, 'fields.schoolName'))
    .fill(lang === 'bn' ? 'সবুজ পাতা বিদ্যালয়' : 'Green Leaf School');
  await page
    .getByLabel(tr(reg, 'fields.address'))
    .fill(lang === 'bn' ? '১২ লেক রোড, ঢাকা' : '12 Lake Road, Dhaka');
  await page.locator('#register-terms').click();
  const started = page.waitForResponse(
    (r) => r.url().includes('/auth/register/start') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: tr(reg, 'continue') }).click();
  const body = (await (await started).json()) as { debug?: { otp: string } };
  const otp = page.locator('#register-otp');
  await expect(otp).toBeVisible();
  await otp.fill('4');
  await shoot(page, `${admin}/create-school-02-code.png`, [
    { target: otp },
    { target: page.getByRole('button', { name: tr(reg, 'otp.verify') }) },
    { target: page.getByText(/Send the code again|Send again in|আবার কোড|আবার পাঠান/).first() },
  ]);
  if (!body.debug?.otp)
    throw new Error('register/start did not echo an OTP (ACCOUNT_ACCESS_ECHO_SECRETS)');
  await otp.fill(body.debug.otp);
  await page.getByRole('button', { name: tr(reg, 'otp.verify') }).click();
  // Step 3 asks for a password (the guide's "Not now" shows only when the server allows skipping).
  await expect(page.getByRole('heading', { name: tr(reg, 'password.title') })).toBeVisible();
  const notNow = page.getByRole('button', { name: tr(reg, 'password.skip') });
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
  } else {
    for (const box of await page.locator('input[type="password"]').all())
      await box.fill('Green-Leaf-2027!');
    await page.getByRole('button', { name: tr(reg, 'password.save') }).click();
  }
  await page.waitForURL(/\/welcome/);
  const doors = page.getByRole('heading', { name: tr('onboardingSetup', 'doors.heading') });
  await expect(doors).toBeVisible();
  await shoot(page, `${admin}/create-school-03-wizard-doors.png`, [
    { target: page.getByRole('radiogroup').first() },
    { target: page.getByRole('list').first() },
  ]);

  // Ready-made curriculum on this brand-new school.
  await page.goto('/curriculum-preset');
  const cp = 'curriculumPreset';
  await expect(page.getByRole('heading', { level: 1, name: tr(cp, 'title') })).toBeVisible();
  const cards = page.getByRole('list', { name: tr(cp, 'cards.label') });
  await expect(cards).toBeVisible();
  // "Step 1 of 3: Choose a curriculum" — the step row.
  const steps = page.getByText(tr(cp, 'steps.pick')).first();
  const nctb = cards.getByRole('group', { name: /NCTB|এনসিটিবি/ }).first();
  const next = page.getByRole('button', { name: tr('common', 'wizard.next') });
  await shoot(page, `${admin}/setup-03-curriculum-preset.png`, [
    { target: steps },
    { target: nctb },
    { target: nctb.getByRole('button', { name: tr(cp, 'cards.select') }) },
  ]);
  const cur = imgDir('administration');
  await shoot(page, `${cur}/curriculum-preset-01.png`, [
    { target: steps },
    { target: nctb },
    { target: nctb.getByText(tr(cp, 'unverifiedBadge')).first() },
    { target: nctb.getByRole('button', { name: tr(cp, 'cards.select') }) },
    { target: nctb.getByRole('button', { name: new RegExp(`^${tr(cp, 'cards.preview')}`) }) },
  ]);
  // NCTB chosen → Options → Confirm, where "Use this curriculum" sits.
  await nctb.getByRole('button', { name: tr(cp, 'cards.select') }).click();
  await next.click();
  await expect(page.getByText(tr(cp, 'options.stages')).first()).toBeVisible();
  // NCTB asks for at least one version; stages come pre-ticked.
  const versions = page.getByRole('group', { name: tr(cp, 'options.versions') });
  if (await versions.isVisible().catch(() => false))
    await versions.getByRole('checkbox').first().check();
  await next.click();
  const useButton = page.getByRole('button', { name: tr(cp, 'submit') });
  await expect(useButton).toBeVisible();
  await shoot(page, `${cur}/curriculum-preset-02.png`, [
    { target: page.getByRole('heading', { level: 1, name: tr(cp, 'title') }) },
    {
      target: page
        .getByRole('listitem')
        .filter({ hasText: tr(cp, 'steps.confirm') })
        .first(),
    },
    {
      target: page
        .getByRole('main')
        .getByRole('paragraph')
        .filter({ hasText: /NCTB|এনসিটিবি/ })
        .first(),
    },
    {
      target: page
        .getByRole('main')
        .getByRole('note')
        .filter({ hasText: tr(cp, 'unverifiedWarning').slice(0, 20) }),
    },
    { target: useButton },
  ]);
  await context.close();
});
