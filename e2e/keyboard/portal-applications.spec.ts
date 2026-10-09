import type { Page } from '@playwright/test';

import bnPortalApplications from '../../ui/src/i18n/locales/bn/portalApplications.json';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { focusedText, selectByTypeahead, tabUntilFocused } from './keyboard-utils';

// [52.6.4] D25 for the family: nav -> New application -> file a leave -> withdraw it, with the
// keyboard only. No `page.mouse`; the one `.click(` is the kit DatePicker helper (as in
// `journeys/applications.spec.ts`), and the attachments step is skipped because a native file
// dialog cannot be driven from the page.

const p = bnPortalApplications;
const THURSDAY = '2026-07-23'; // a school day, clear of every seeded holiday and closure

/** The kit DatePicker, mouse-driven on purpose (see above), paging months until `iso` shows. */
async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  const cell = page.locator(`[role="grid"] [data-date="${iso}"]`);
  for (let i = 0; i < 36 && !(await cell.isVisible()); i += 1) {
    const shown = await page.locator('[role="grid"] [data-date]').nth(15).getAttribute('data-date');
    const key = (shown ?? iso) > iso ? 'common.date.previousMonth' : 'common.date.nextMonth';
    await page.getByRole('button', { name: t(key) }).click();
  }
  await cell.click();
  await expect(page.getByRole('grid')).toHaveCount(0);
}

/** Tab to the footer primary (labelled `label`) and press Enter. */
async function next(page: Page, label: string): Promise<void> {
  await tabUntilFocused(page, label, 80, { tag: 'button', exact: true });
  await page.keyboard.press('Enter');
}

test.use(loggedIn('parent'));

test('keyboard-only: portal nav -> file a leave -> withdraw it', async ({ page }) => {
  await page.goto('/portal');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await tabUntilFocused(page, t('nav.items.portalApplications'), 120, { tag: 'a', exact: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeFocused();

  // The page's default child may not be the one with applications; any child can file.
  await tabUntilFocused(page, p.newApplication, 40, { tag: 'a', exact: true });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/portal\/applications\/new/);

  // Step 1: ChoiceCards. Arrows move through the types, Space picks the focused one.
  const leave = new RegExp(t('applications.types.STUDENT_LEAVE'));
  // The cards render once the child is known; Tabbing earlier lands on the shell's own controls.
  await expect(page.getByRole('radio', { name: leave })).toBeVisible();
  await tabUntilFocused(page, t('applications.types.STUDENT_LEAVE'), 30, { tag: 'button' });
  expect(await focusedText(page)).toMatch(leave);
  // Arrows move AND select (Radix radio group), a frame later: go to the next card and back (each
  // waits for the focus to land), then Space picks the focused one.
  const focusedValue = () => page.evaluate(() => document.activeElement?.getAttribute('value'));
  await page.keyboard.press('ArrowDown');
  await expect.poll(focusedValue).not.toBe('STUDENT_LEAVE');
  await page.keyboard.press('ArrowUp');
  await expect.poll(focusedValue).toBe('STUDENT_LEAVE');
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: leave })).toBeChecked();
  await next(page, p.new.actions.next);

  // Step 2: details.
  await expect(page.getByRole('heading', { name: p.new.steps.details })).toBeFocused();
  await tabUntilFocused(page, t('applicationForms.fields.reasonKind'), 20);
  await selectByTypeahead(page, t('applications.reasons.SICK'));
  await pickDate(page, t('applicationForms.fields.startDate'), THURSDAY);
  await pickDate(page, t('applicationForms.fields.endDate'), THURSDAY);
  await tabUntilFocused(page, t('applicationForms.fields.details'), 20);
  await page.keyboard.type('E2E কীবোর্ড');
  await next(page, p.new.actions.next);

  // Steps 3 and 4: no file, then the letter.
  await expect(page.getByRole('heading', { name: p.new.steps.attachments })).toBeFocused();
  await next(page, p.new.actions.next);
  await expect(page.getByRole('heading', { name: p.new.steps.preview })).toBeFocused();
  await next(page, p.new.actions.submit);

  // The detail page: its heading takes focus.
  await expect(page).toHaveURL(/\/portal\/applications\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByText(t('applications.statuses.PENDING')).first()).toBeVisible();

  // Withdraw: action, then Enter on the confirm button.
  await tabUntilFocused(page, t('applicationsDetail.actions.withdraw'), 40, { tag: 'button' });
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toBeVisible();
  await tabUntilFocused(page, t('applicationsDetail.dialogs.withdraw.confirm'), 5, {
    tag: 'button',
  });
  await page.keyboard.press('Enter');
  await expect(page.getByText(t('applications.statuses.WITHDRAWN')).first()).toBeVisible();
});
