import { adminApiSession, createClassSection, createTeacher } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [29.0/#1025] Class detail's Teachers tab, KEYBOARD ONLY: tab into the
 * per-section "Assign" button, pick a teacher through the shared
 * `AssignTeacherDialog` combobox (same type/ArrowDown/Enter shape
 * `command-palette.spec.ts` already exercises for a combobox), submit,
 * and see the new row without a reload.
 */

test.use(loggedIn('admin'));

test('keyboard-only: assign a teacher from the class detail Teachers tab', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className } = await createClassSection(request, session);
  const teacherName = `E2E Teacher ${Date.now()}`;
  // `createTeacher`, not `createTeacherForSection` — this spec's own
  // empty-state assertion below needs a teacher with zero assignments to
  // start; `createTeacherForSection` always creates a class-teacher row.
  await createTeacher(request, session, teacherName);

  await page.goto(`/classes/${classId}?tab=teachers`);
  await expect(page.getByRole('heading', { name: className })).toBeVisible();
  await expect(page.getByText(t('classes.detail.teachers.emptySectionMessage'))).toBeVisible();

  await test.step('tab to Assign, keyboard only', async () => {
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('classes.detail.teachers.assign'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  const dialog = page.getByRole('dialog', { name: t('classes.assignTeacherForm.title') });
  await expect(dialog).toBeVisible();

  await test.step('pick a teacher and submit, keyboard only', async () => {
    const combo = dialog.getByRole('combobox', {
      name: t('classes.assignTeacherForm.teacherLabel'),
    });
    await combo.focus();
    await page.keyboard.type(teacherName);
    await expect(dialog.getByRole('option', { name: new RegExp(teacherName) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, t('classes.assignTeacherForm.save'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText(new RegExp(teacherName))).toBeVisible();
});
