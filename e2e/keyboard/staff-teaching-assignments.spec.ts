import { adminApiSession, createClassSection, createTeacherForSection } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [29.0/#1026] Staff detail's Teaching assignments tab, KEYBOARD ONLY: tab
 * into the tab strip to reach the new tab, tab into "Assign", pick a
 * class/section/teacher through the shared `AssignTeacherDialog` in its
 * teacher-centric mode (no fixed section — the dialog renders its own
 * class→section pickers), submit, and see the new row without a reload.
 * Mirrors `class-teachers.spec.ts`'s structure for the class-centric mode.
 */

test.use(loggedIn('admin'));

test('keyboard-only: assign a class/section from the staff detail Teaching assignments tab', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { sectionId, className } = await createClassSection(request, session);
  // `createClassSection` always names its one section "A".
  const sectionName = 'A';
  const teacherName = `E2E Teacher ${Date.now()}`;
  const teacher = await createTeacherForSection(request, session, teacherName, sectionId);

  await page.goto(`/staff/${teacher.userId}`);
  await expect(page.getByRole('heading', { name: teacherName })).toBeVisible();

  await test.step('tab to the Teaching assignments tab, keyboard only', async () => {
    await tabUntilFocused(page, t('staff.detail.tabs.teachingAssignments'), 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await expect(page.getByText(t('staff.detail.teachingAssignments.emptyMessage'))).toBeVisible();

  await test.step('tab to Assign, keyboard only', async () => {
    await tabUntilFocused(page, t('staff.detail.teachingAssignments.assign'), 20, {
      tag: 'BUTTON',
    });
    await page.keyboard.press('Enter');
  });

  const dialog = page.getByRole('dialog', { name: t('classes.assignTeacherForm.title') });
  await expect(dialog).toBeVisible();
  // Teacher-centric mode: the teacher picker is hidden, prefilled from the route.
  await expect(
    dialog.getByRole('combobox', { name: t('classes.assignTeacherForm.teacherLabel') }),
  ).toHaveCount(0);

  await test.step('pick class and section, keyboard only', async () => {
    const classCombo = dialog.getByRole('combobox', {
      name: t('classes.assignTeacherForm.classLabel'),
    });
    await classCombo.focus();
    await page.keyboard.type(className);
    await expect(dialog.getByRole('option', { name: new RegExp(className) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('classes.assignTeacherForm.sectionLabel'), 10);
    await page.keyboard.type(sectionName);
    await expect(dialog.getByRole('option', { name: new RegExp(sectionName) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('classes.assignTeacherForm.save'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText(className)).toBeVisible();
});
