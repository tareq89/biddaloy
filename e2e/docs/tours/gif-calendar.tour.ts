/** [Epic 42] Calendar: add an event as a draft, publish it, see it on the month grid. */
import { expect, type Page } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const DAY = process.env.GUIDE_EVENT_DAY ?? '2026-11-12';
const NAME = 'Annual sports day';

async function pickDate(p: Page, label: string): Promise<void> {
  await p.getByLabel(label).click();
  await expect(p.getByRole('grid', { name: tr('common', 'date.calendar') })).toBeVisible();
  const cell = p.locator(`[role="grid"] [data-date="${DAY}"]`);
  if (!(await cell.isVisible()))
    await p.getByRole('button', { name: tr('common', 'date.nextMonth') }).click();
  await cell.click();
  await expect(cell).toBeHidden();
}

gifTour(
  'calendar: add and publish an event',
  { card: 'admin', file: 'calendar-add-publish.gif' },
  async (p) => {
    await p.goto(`/calendar?month=${DAY.slice(0, 7)}`);
    await expect(
      p.getByRole('heading', { level: 1, name: tr('calendar', 'page.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('calendar', 'page.addEvent') }).click();
    await expect(
      p.getByRole('heading', { name: tr('calendar', 'eventForm.createTitle') }),
    ).toBeVisible();
    await beat(p);
    await p.locator('#event-form-name').pressSequentially(NAME, { delay: 40 });
    await pickDate(p, tr('calendar', 'eventForm.startDate'));
    await pickDate(p, tr('calendar', 'eventForm.endDate'));
    await beat(p, 400);
    const publishNow = p.getByRole('checkbox', { name: tr('calendar', 'eventForm.publishNow') });
    await publishNow.scrollIntoViewIfNeeded();
    await publishNow.uncheck();
    await beat(p);
    await p.getByRole('button', { name: tr('calendar', 'eventForm.save') }).click();
    const chip = p.getByTestId(`day-cell-${DAY}`).getByText(NAME);
    await expect(chip).toBeVisible();
    await beat(p, 1000);
    await chip.click();
    await beat(p);
    await p.getByRole('button', { name: tr('calendar', 'eventDetails.publish') }).click();
    await expect(
      p.getByRole('button', { name: tr('calendar', 'eventDetails.publish') }),
    ).toBeHidden();
    await beat(p, 800);
    await p.keyboard.press('Escape');
    await beat(p, 600);
  },
);
