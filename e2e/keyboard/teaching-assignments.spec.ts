import { adminApiSession, createClassSection, createTeacherForSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [29.0] Teaching assignments bulk view, KEYBOARD ONLY for navigation, the
 * class filter, and unassign — no `page.mouse` and no `.click(` call in
 * this file.
 *
 * The "Assign teacher" flow itself is deliberately **not** driven here:
 * its `Combobox` teacher picker (`-assign-teacher-dialog.tsx`) has no
 * keyboard-only precedent anywhere in this suite yet (grep it — every
 * existing `Combobox` usage is exercised through `.click(` elsewhere), so
 * faking one here risks asserting behavior no other spec has proven. A
 * seeded assignment (via the API, same as `createTeacherForSection`'s own
 * seeding) plus this spec's own keyboard unassign covers the row action
 * that *is* new to this route. Driving the assign dialog itself by
 * keyboard is flagged as a follow-up once a `Combobox` keyboard pattern
 * exists to clone.
 */

test.use(loggedIn('admin'));

test('keyboard-only: filter by class, then unassign a teacher', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const chain = await createClassSection(request, session);
  const teacher = await createTeacherForSection(
    request,
    session,
    'Keyboard Teacher',
    chain.sectionId,
  );
  await post(request, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
    teacher_id: teacher.teacherId,
  });

  await page.goto('/staff/teaching-assignments');
  await expect(
    page.getByRole('heading', { name: t('teacherAssignments.list.title') }),
  ).toBeVisible();

  await test.step('select the class by keyboard', async () => {
    // Cold `page.goto` leaves focus on `<body>` (no route-focus target on
    // first load) — the shell's nav sidebar + header sit between it and
    // this page's own filter bar, so budget for all of that, not just the
    // filter itself. Same body-reset preamble as `organisation-structure.spec.ts`.
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('teacherAssignments.list.classLabel'), 60, {
      tag: 'BUTTON',
    });
    // `selectByTypeahead` opens the trigger itself (presses Enter), then
    // types and waits for the exact option before picking it — typing
    // right after the Enter that opens the listbox can lose keystrokes to
    // its open animation.
    await selectByTypeahead(page, chain.className);

    await expect(page.getByText('Keyboard Teacher')).toBeVisible();
  });

  await test.step('unassign by keyboard', async () => {
    await tabUntilFocused(page, t('teacherAssignments.list.unassign'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toBeVisible();
    await tabUntilFocused(page, t('teacherAssignments.unassignDialog.confirm'), 10, {
      tag: 'BUTTON',
    });
    await page.keyboard.press('Enter');

    await expect(page.getByText('Keyboard Teacher')).toBeHidden();
  });
});
