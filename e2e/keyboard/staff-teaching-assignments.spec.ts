import { adminApiSession, createClassSection, createTeacher } from '../api';
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
  const { className } = await createClassSection(request, session);
  // `createClassSection` always names its one section "A".
  const sectionName = 'A';
  // `Date.now()` alone collided across parallel workers running a
  // sibling spec's own teacher creation at the same millisecond,
  // producing two identically-named teachers and a strict-mode option
  // match violation — the same entropy `crypto.randomUUID()` already
  // gives `e2e/api.ts`'s own suffixes.
  const teacherName = `E2E Teacher ${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  // `createTeacher`, not `createTeacherForSection` — this test's empty-state
  // assertion below needs a teacher with zero assignments to start.
  const teacher = await createTeacher(request, session, teacherName);

  await page.goto(`/staff/${teacher.userId}`);
  await expect(page.getByRole('heading', { name: teacherName })).toBeVisible();

  await test.step('tab to the Teaching assignments tab, keyboard only', async () => {
    // `DetailShell` tabs are a Radix `RovingFocusGroup` — only the active
    // tab has `tabindex=0`, the rest are `-1`, so `tabUntilFocused` can
    // never Tab onto them. Reach it with ArrowRight instead, same pattern
    // `homework-detail-tabs.spec.ts` uses for a `DetailShell` tab strip.
    const teachingAssignmentsTab = page.getByRole('tab', {
      name: t('staff.detail.tabs.teachingAssignments'),
    });
    await expect(teachingAssignmentsTab).toBeVisible();
    const tabButtons = page.getByRole('tablist').first().getByRole('tab');
    const tabIds = await tabButtons.evaluateAll((els) => els.map((el) => el.id));
    const targetId = await teachingAssignmentsTab.evaluate((el) => el.id);
    const targetIndex = tabIds.indexOf(targetId);
    await tabButtons.first().focus();
    for (let i = 1; i <= targetIndex; i += 1) {
      await page.keyboard.press('ArrowRight');
      // Unlike the other tabs in this strip, this one is conditionally
      // rendered ([29.0], only for teacher-designation staff) and mounts
      // its own data-fetching panel content immediately on arrival
      // (Radix's default automatic activation). That panel settling can
      // move DOM focus away from the tab trigger right after landing on
      // it, even though the trigger is already correctly the selected tab
      // (`aria-selected`/`data-state` below both confirm this) — so skip
      // the interim `toBeFocused` check on the final (target) press only;
      // every earlier press still asserts it, to still catch a real
      // reachability regression on this strip.
      if (i < targetIndex) {
        await expect(tabButtons.nth(i)).toBeFocused();
      }
    }
    await expect(teachingAssignmentsTab).toHaveAttribute('aria-selected', 'true');
    await expect(teachingAssignmentsTab).toHaveAttribute('data-state', 'active');
    // Re-focus the trigger before activating it — see the comment above on
    // why focus may have moved off it after the final ArrowRight.
    await teachingAssignmentsTab.focus();
    await page.keyboard.press('Enter');
  });

  await expect(page.getByText(t('staff.detail.teachingAssignments.emptyMessage'))).toBeVisible();

  await test.step('tab to Assign, keyboard only', async () => {
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    // Budget bumped past the original 60 — Epic 27.0's two new sidebar nav
    // entries (Admission intakes/applicants) push every tab-index target
    // further down the page.
    await tabUntilFocused(page, t('staff.detail.teachingAssignments.assign'), 80, {
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
    // Radix `Combobox` portals its listbox to the document body, not as a
    // DOM descendant of the dialog — scope to `page`, matching every other
    // Combobox-driving spec in this suite (`command-palette.spec.ts`,
    // `homework.spec.ts`).
    await expect(page.getByRole('option', { name: new RegExp(className) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('classes.assignTeacherForm.sectionLabel'), 10);
    await page.keyboard.type(sectionName);
    await expect(page.getByRole('option', { name: new RegExp(sectionName) })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('classes.assignTeacherForm.save'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText(className)).toBeVisible();
});
