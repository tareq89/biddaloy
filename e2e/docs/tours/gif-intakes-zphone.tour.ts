/** [Epic 42] Admission rounds, guest half: a guardian applies on a phone, no sign-in. */
import { expect, type Page } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const ns = 'admission-public';
const SLUG = process.env.GUIDE_SCHOOL_SLUG ?? 'bmsc-high';
/** The round gif-intakes.tour.ts added. */
const TITLE = process.env.GUIDE_INTAKE_TITLE ?? 'Admission 2027: Class 7';
const DOB = process.env.GUIDE_DOB ?? '2015-03-10';

/** Open the date picker, jump to the birth year through the month/year view, pick the day. */
async function pickDob(p: Page): Promise<void> {
  // The only date picker on the form: the button that reads "Pick a date".
  await p
    .locator('button', { hasText: tr('common', 'date.pick') })
    .first()
    .tap();
  await expect(p.getByRole('grid', { name: tr('common', 'date.calendar') })).toBeVisible();
  const [year, month] = DOB.split('-').map(Number);
  await p.getByRole('button', { name: tr('common', 'date.chooseMonthYear') }).click();
  const back = p.getByRole('button', { name: tr('common', 'date.previousYear') });
  for (let y = new Date().getFullYear(); y > year; y--) {
    await back.click();
    await p.waitForTimeout(120);
  }
  const monthName = new Intl.DateTimeFormat('en', { month: 'short' }).format(
    new Date(year, month - 1, 1),
  );
  await p
    .getByRole('button', { name: new RegExp(`^${monthName}`, 'i') })
    .first()
    .click();
  await p.locator(`[role="grid"] [data-date="${DOB}"]`).click();
}

gifTour(
  'admission rounds: guardian applies on a phone',
  { file: 'people-admission-intakes-flow-phone.gif', phone: true },
  async (p) => {
    await p.goto(`/admission/${SLUG}`);
    await expect(p.getByRole('heading', { level: 1, name: tr(ns, 'form.title') })).toBeVisible();
    await beat(p, 1000);
    const intake = p.getByRole('combobox', { name: tr(ns, 'form.fields.intake') });
    if (await intake.isVisible().catch(() => false)) {
      await intake.tap();
      await p.getByRole('option', { name: TITLE }).tap();
      await expect(p.getByRole('option')).toHaveCount(0);
      await beat(p, 600);
    }
    await p
      .getByLabel(tr(ns, 'form.fields.applicantName'))
      .pressSequentially('Tanisha Rahman', { delay: 40 });
    await pickDob(p);
    await beat(p, 400);
    await p.getByRole('combobox', { name: tr(ns, 'form.fields.gender') }).tap();
    await p.getByRole('option', { name: tr(ns, 'form.fields.genderOptions.FEMALE') }).tap();
    await beat(p, 400);
    await p
      .getByLabel(tr(ns, 'form.fields.guardianName'))
      .pressSequentially('Mizanur Rahman', { delay: 40 });
    await p
      .getByLabel(tr(ns, 'form.fields.guardianPhone'))
      .pressSequentially('01700000123', { delay: 50 });
    await beat(p, 600);
    const submit = p.getByRole('button', { name: tr(ns, 'form.submit') });
    await submit.scrollIntoViewIfNeeded();
    await beat(p, 400);
    await submit.tap();
    await expect(p.getByTestId('reference-number')).toBeVisible();
    await beat(p, 1500);
  },
);
