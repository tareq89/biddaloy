/** [Epic 42, redone for Epic 71] Admission rounds: create a round with the four-step wizard. */
import { expect, type Page } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const ns = 'admission-staff-intakes';
const desk = 'admission-desk';
const OPEN = process.env.GUIDE_INTAKE_OPEN ?? '2026-10-20';
const CLOSE = process.env.GUIDE_INTAKE_CLOSE ?? '2026-12-15';

async function pickDate(p: Page, id: string, iso: string): Promise<void> {
  await p.locator(`#${id}`).click();
  await expect(p.getByRole('grid', { name: tr('common', 'date.calendar') })).toBeVisible();
  const cell = p.locator(`[role="grid"] [data-date="${iso}"]`);
  for (let i = 0; i < 6 && !(await cell.isVisible()); i++) {
    await p.getByRole('button', { name: tr('common', 'date.nextMonth') }).click();
    await p.waitForTimeout(250);
  }
  await cell.click();
  await expect(cell).toBeHidden();
}

gifTour(
  'admission rounds: add a round with the wizard',
  { card: 'admin', file: 'people-admission-intakes-flow.gif' },
  async (p) => {
    await p.goto('/admissions/intakes');
    await expect(p.getByRole('heading', { level: 1, name: tr(ns, 'list.title') })).toBeVisible();
    await beat(p, 1000);
    await p
      .getByRole('button', { name: tr(ns, 'list.addIntake') })
      .first()
      .click();
    const next = p.getByRole('button', { name: tr('common', 'wizard.next') });
    // Step 1: class and kind.
    await p.locator('#wz-class').click();
    await p
      .getByRole('option', { name: /Class 7/ })
      .first()
      .click();
    await p.locator('#wz-kind-WRITTEN').click();
    await beat(p, 600);
    await next.click();
    // Step 2: seats and dates.
    await p.locator('#wz-seats').fill('');
    await p.locator('#wz-seats').pressSequentially('40', { delay: 80 });
    await pickDate(p, 'wz-open', OPEN);
    await pickDate(p, 'wz-close', CLOSE);
    await beat(p, 600);
    await next.click();
    // Step 3: fee and form. No fee, recommended boxes.
    await expect(p.getByText(tr(desk, 'wizard.fieldsTitle'))).toBeVisible();
    await beat(p, 800);
    await next.click();
    // Step 4: publish, then create. The round's desk opens.
    await beat(p, 800);
    await p.getByRole('button', { name: tr(desk, 'wizard.create') }).click();
    await expect(p).toHaveURL(/\/admissions\/rounds\//);
    await beat(p, 1500);
  },
);
