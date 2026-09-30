import type { Page } from '@playwright/test';

import { adminApiSession, get } from '../api';
import { expectNoAxeViolations } from '../a11y/assert';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_LIFECYCLE_STUDENTS } from '../seed-contract';

import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [39.6.2] Keyboard-only lifecycle journey on a seeded student (Epic 39.0
 * D9/D10/D26): students list > Enter > detail > Tab to "Record leaving" >
 * form > Ctrl+Enter > Records timeline; then Readmit; then a note. Serial:
 * one seeded student, each step depends on the last one's status. Ends
 * ACTIVE again, so a re-run against the same DB starts from the same state.
 *
 * The palette cannot do any of this (`run()` cannot carry the student id),
 * see `unregistered-actions.ts`.
 */

const REG_NO = SEED_LIFECYCLE_STUDENTS.withdrawnThenReadmitted;

interface StudentRow {
  id: string;
  full_name: string;
  class_section: { section_name: string; class: { name: string } };
}

async function resetFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

/** Records and Notes are the last two tabs: End reaches Notes, ArrowLeft Records. */
async function openTabByKeyboard(page: Page, tab: 'records' | 'notes'): Promise<void> {
  const tabs = page.getByRole('tablist').first().getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('End');
  const notes = tabs.last();
  await expect(notes).toBeFocused();
  if (tab === 'records') {
    // Await each press: roving focus moves in a setTimeout + view transition.
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(-2)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('tabpanel', { name: t(`students.detail.tabs.${tab}`), exact: true }),
  ).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('student lifecycle, keyboard only', () => {
  test.use(loggedIn('admin'));

  let student: StudentRow;

  test.beforeEach(async ({ request }) => {
    const session = await adminApiSession(request);
    const list = await get<{ data: StudentRow[] }>(request, session, `/students?search=${REG_NO}`);
    student = list.data[0]!;
  });

  test('(a) list > Enter > Record leaving > Ctrl+Enter > timeline; focus after close', async ({
    page,
  }) => {
    const reason = `Kbd leave ${Date.now()}`;
    await page.goto(`/students?search=${REG_NO}`);
    await expect(
      page.getByRole('heading', { level: 1, name: t('students.list.title') }),
    ).toBeVisible();

    await test.step('Enter on the student row link opens the detail', async () => {
      await expect(page.getByRole('link', { name: t('students.list.view') })).toBeVisible();
      await resetFocus(page);
      await tabUntilFocused(page, t('students.list.view'), 200, { tag: 'A' });
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/students/${student.id}`));
      await expect(page.getByRole('heading', { level: 1, name: student.full_name })).toBeVisible();
    });

    const dialog = page.getByRole('dialog', { name: t('student-lifecycle.leave.title') });
    await test.step('Tab to Record leaving, Enter, fill, Ctrl+Enter', async () => {
      await resetFocus(page);
      await tabUntilFocused(page, t('students.detail.actions.recordLeaving'), 120, {
        tag: 'BUTTON',
      });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(t('student-lifecycle.leave.reasonLabel')).focus();
      await page.keyboard.type(reason);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(dialog).toBeHidden();
    });

    await test.step('focus after close', async () => {
      // The trigger unmounts once the student is no longer ACTIVE; focus must
      // move to the replacement "Readmit" action, not fall to <body>.
      await expect(
        page.getByRole('button', { name: t('students.detail.actions.readmit') }),
      ).toBeFocused();
    });

    await test.step('Records tab timeline shows the event', async () => {
      await openTabByKeyboard(page, 'records');
      await expect(page.getByText(reason)).toBeVisible();
    });
  });

  test('(b) Readmit the same student, keyboard only; focus after close', async ({ page }) => {
    await page.goto(`/students/${student.id}`);
    await expect(page.getByRole('heading', { level: 1, name: student.full_name })).toBeVisible();

    const dialog = page.getByRole('dialog', { name: t('student-lifecycle.readmit.title') });
    await resetFocus(page);
    await tabUntilFocused(page, t('students.detail.actions.readmit'), 120, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(t('student-lifecycle.readmit.classLabel')).focus();
    await selectByTypeahead(page, student.class_section.class.name);
    await dialog.getByLabel(t('student-lifecycle.readmit.sectionLabel')).focus();
    await selectByTypeahead(page, student.class_section.section_name);
    await dialog.getByLabel(t('student-lifecycle.readmit.reasonLabel')).focus();
    await page.keyboard.type('Kbd readmit');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();

    // ACTIVE again: focus moves to the replacement "Record leaving" action.
    await expect(
      page.getByRole('button', { name: t('students.detail.actions.recordLeaving') }),
    ).toBeFocused();

    await openTabByKeyboard(page, 'records');
    await expect(
      page.getByText(t('student-records.timeline.types.READMITTED')).first(),
    ).toBeVisible();
  });

  test('(c) Notes tab: add a note by keyboard', async ({ page }) => {
    const body = `Kbd note ${Date.now()}`;
    await page.goto(`/students/${student.id}`);
    await expect(page.getByRole('heading', { level: 1, name: student.full_name })).toBeVisible();
    await openTabByKeyboard(page, 'notes');

    await tabUntilFocused(page, t('student-notes.add'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t('student-notes.addTitle') });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(t('student-notes.bodyLabel')).focus();
    await page.keyboard.type(body);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(body)).toBeVisible();
  });

  // Scoped to <main>: the sidebar's unlabelled /exams link is not this ticket's.
  test('axe: Records and Notes tabs are clean', async ({ page }) => {
    await page.goto(`/students/${student.id}`);
    await expect(page.getByRole('heading', { level: 1, name: student.full_name })).toBeVisible();
    await openTabByKeyboard(page, 'records');
    await expect(page.getByText(t('student-records.timeline.title'))).toBeVisible();
    await expectNoAxeViolations(page, 'main');
    await openTabByKeyboard(page, 'notes');
    await expect(page.getByRole('button', { name: t('student-notes.add') })).toBeVisible();
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('guardian session', () => {
  test.use(loggedIn('parent'));

  test('(d) cannot see the Records or Notes tabs', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const list = await get<{ data: StudentRow[] }>(request, session, `/students?search=${REG_NO}`);
    await page.goto(`/students/${list.data[0]!.id}`);
    // A guardian is bounced to the portal; either way no staff tab strip renders.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: t('students.detail.tabs.records') })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: t('students.detail.tabs.notes') })).toHaveCount(0);
  });
});
