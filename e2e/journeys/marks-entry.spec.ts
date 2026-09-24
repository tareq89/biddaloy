import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from '../keyboard/keyboard-utils';

/**
 * [19.10.1] Marks entry, KEYBOARD ONLY — no `page.mouse` and no `.click(`
 * reaches the grid itself. Covers the issue's step 4 journey: type marks
 * with Enter/Tab, mark one student absent with `A`, watch the save-state
 * line settle to "saved", submit with `Ctrl+Enter`.
 *
 * **Judgment call on the persona:** the issue names a TEACHER login, but
 * `MarksAuthorizationService.assertCanWrite` requires a
 * `teacher_class_sections` row whose `subject_id` matches the grid's
 * subject exactly (`marks-authorization.util.ts`) — and no API endpoint in
 * this codebase can create that subject-scoped row (`POST /teachers`'s
 * `assigned_section_ids` only ever creates a `subject_id: null` mapping,
 * the same shape `ensureAttendanceSeed` uses). With no DB access from the
 * e2e layer either, this spec logs in as ADMIN instead — `ADMIN_LEVEL_ROLES`
 * bypasses the subject-teacher check, and the grid's keyboard behaviour
 * (`marks-grid.tsx`'s `handleKeyDown`) is identical regardless of which
 * role is driving it. Reported to the parent as a real gap: there is no
 * write path for a subject-specific teacher assignment yet.
 */

test.use(loggedIn('admin'));

test('keyboard-only: type marks, mark one absent, watch autosave settle, submit', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const chain = await createClassSection(request, session);

  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `E2E-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Subject',
    name_bn: 'ই২ই বিষয়',
  });

  const exam = await post<{ id: string; name: string }>(request, session, '/exams', {
    name: `E2E Marks Exam ${Date.now()}`,
    kind: ExamKind.TERM,
    academic_year_id: chain.academicYearId,
    class_id: chain.classId,
  });

  await post(request, session, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });

  const studentOne = await post<{ id: string; full_name: string }>(request, session, '/students', {
    full_name: 'Marks Entry Student One',
    class_section_id: chain.sectionId,
  });
  const studentTwo = await post<{ id: string; full_name: string }>(request, session, '/students', {
    full_name: 'Marks Entry Student Two',
    class_section_id: chain.sectionId,
  });

  await page.goto(`/marks/${exam.id}/${chain.sectionId}/${subject.id}`);
  await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();

  const firstCellLabel = t('exams.marksGrid.cellLabel', {
    name: studentOne.full_name,
    component: 'Written',
  });
  const secondCellLabel = t('exams.marksGrid.cellLabel', {
    name: studentTwo.full_name,
    component: 'Written',
  });

  await test.step('tab to the first student’s cell', async () => {
    await tabUntilFocused(page, firstCellLabel, 60, { tag: 'input' });
  });

  await test.step('type a mark, Enter moves to the next row', async () => {
    await page.keyboard.type('78');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(secondCellLabel)).toBeFocused();
  });

  await test.step('mark the second student absent with "A"', async () => {
    await page.keyboard.press('a');
    await expect(page.getByLabel(secondCellLabel)).toHaveValue(t('exams.marksGrid.absentShort'));
  });

  await test.step('the save-state line settles to "saved"', async () => {
    await expect(page.getByTestId('save-state-line')).toContainText(t('exams.saveState.saving'));
    await expect(page.getByTestId('save-state-line')).toContainText(
      t('exams.saveState.saved').split('·')[0].trim(),
      { timeout: 15_000 },
    );
  });

  await test.step('Ctrl+Enter opens the submit dialog, confirm submits', async () => {
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: t('exams.submitDialog.title') })).toBeVisible();
    await tabUntilFocused(page, t('exams.submitDialog.confirm'), 20, { tag: 'button' });
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(firstCellLabel)).toBeDisabled();
  });

  await test.step('the server actually recorded it', async () => {
    const grid = await request.get(
      `/api/v1/exams/${exam.id}/marks?section_id=${chain.sectionId}&subject_id=${subject.id}`,
      {
        headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      },
    );
    if (!grid.ok()) throw new Error(`GET grid failed: ${grid.status()} ${await grid.text()}`);
    const body = (await grid.json()) as {
      state: string;
      cells: { student_id: string; value: string | null; status: string }[];
    };
    expect(body.state).toBe('SUBMITTED');
    const cellOne = body.cells.find((c) => c.student_id === studentOne.id);
    const cellTwo = body.cells.find((c) => c.student_id === studentTwo.id);
    expect(cellOne?.status).toBe('PRESENT');
    expect(cellOne?.value).toBe('78.00');
    // D10: an ABSENT mark's value must round-trip as null, never a
    // coerced zero.
    expect(cellTwo?.status).toBe('ABSENT');
    expect(cellTwo?.value).toBeNull();
  });
});
