import { adminApiSession, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [35.5.3] Exam templates, KEYBOARD ONLY: create a template, fill its
 * component grid (Enter in the last pass cell appends a row, Esc discards
 * unsaved edits), save, then create an exam from it and read the created-count
 * toast. No `page.mouse` and no `.click(` call anywhere in this file.
 *
 * Runs on the shared seeded tenant: everything it writes (subject, year,
 * class, template, exam) carries a unique suffix, so reruns and parallel
 * workers never collide, and nothing it reads is shared mutable state.
 */
test.use(loggedIn('admin'));

test('create a template, fill the grid, save, then create an exam from it', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.toUpperCase();
  const subjectCode = `E2E-${suffix}`;
  const subjectName = `Kbd Subject ${suffix}`;
  const yearName = `Kbd Tpl Year ${suffix}`;
  const className = `Kbd Tpl Class ${suffix}`;
  const templateName = `Kbd Template ${suffix}`;
  const examName = `Kbd Exam ${suffix}`;
  const grade = 7;

  await test.step('seed (API): a grade-7 class that offers one subject', async () => {
    const session = await adminApiSession(request);
    const year = await post<{ id: string }>(request, session, '/academic-years', {
      name: yearName,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    const klass = await post<{ id: string }>(request, session, '/classes', {
      name: className,
      academic_year_id: year.id,
      numeric_grade: grade,
    });
    const subject = await post<{ id: string }>(request, session, '/subjects', {
      code: subjectCode,
      name_en: subjectName,
    });
    await post(request, session, `/classes/${klass.id}/subjects`, {
      subject_id: subject.id,
      academic_year_id: year.id,
    });
  });

  await test.step('nav link -> Exam templates, "New template", name, Enter', async () => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await tabUntilFocused(page, t('nav.items.examTemplates'), 120, { tag: 'a' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: t('examTemplates.list.title') }),
    ).toBeFocused();
    await tabUntilFocused(page, t('examTemplates.list.add'), 40, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('textbox', { name: t('examTemplates.form.nameLabel') }),
    ).toBeFocused();
    await page.keyboard.type(templateName);
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/exam-templates'),
    );
    await page.keyboard.press('Enter');
    expect((await created).ok()).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: templateName })).toBeVisible();
  });

  await test.step('add class 7 and the subject', async () => {
    // "Add class" opens a small dialog with one field; Enter adds the class and selects its tab.
    await tabUntilFocused(page, t('examTemplates.grid.addGrade'), 40, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('textbox', { name: t('examTemplates.grid.gradeLabel') }),
    ).toBeFocused();
    await page.keyboard.type(String(grade));
    await page.keyboard.press('Enter');
    // The add-subject card of the new class sits below the tab row.
    await tabUntilFocused(page, t('examTemplates.grid.subjectPicker', { grade }), 10);
    await selectByTypeahead(page, subjectCode);
    await tabUntilFocused(page, t('examTemplates.grid.addSubject'), 3, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  const cell = (column: string, row: number) =>
    page.getByRole('textbox', {
      name: t('examTemplates.grid.cellLabel', {
        column: t(column),
        subject: `${subjectCode} — ${subjectName}`,
        grade,
        row,
      }),
    });

  const kindSelect = (row: number) =>
    page.getByRole('combobox', {
      name: t('examTemplates.grid.cellLabel', {
        column: t('examTemplates.grid.columnKind'),
        subject: `${subjectCode} — ${subjectName}`,
        grade,
        row,
      }),
    });

  await test.step('row 1 by Tab; Enter in the last pass cell appends row 2', async () => {
    // Adding a subject focuses its first component's name field.
    await expect(cell('examTemplates.grid.columnName', 1)).toBeFocused();
    await page.keyboard.type('Written');
    await page.keyboard.press('Tab'); // kind select
    await page.keyboard.press('Tab');
    await expect(cell('examTemplates.grid.columnFull', 1)).toBeFocused();
    await page.keyboard.type('70');
    await page.keyboard.press('Tab');
    await page.keyboard.type('23');
    await page.keyboard.press('Enter');

    await expect(cell('examTemplates.grid.columnName', 2)).toBeFocused();
    await page.keyboard.type('MCQ');
    await page.keyboard.press('Tab');
    await expect(kindSelect(2)).toBeFocused();
    // Arrow keys, not `selectByTypeahead`: typing Bangla into an open Select
    // also lands the text in the neighbouring name input (synthetic insertText).
    await page.keyboard.press('Enter');
    const mcq = page.getByRole('option', { name: t('exams.componentKind.MCQ') });
    await expect(
      page.getByRole('option', { name: t('exams.componentKind.WRITTEN') }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown'); // MCQ follows WRITTEN
    await expect(mcq).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(kindSelect(2)).toHaveText(t('exams.componentKind.MCQ'));
    await page.keyboard.press('Tab');
    await page.keyboard.type('30');
    await page.keyboard.press('Tab');
    await page.keyboard.type('10');
  });

  await test.step('save', async () => {
    // Save lives in the page header (above the grid): focus it directly, then press Enter.
    await page.getByRole('button', { name: t('examTemplates.detail.save') }).focus();
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && /\/exam-templates\/[^/]+$/.test(r.url()),
    );
    await page.keyboard.press('Enter');
    expect((await saved).ok()).toBe(true);
    // Saved marks show in the tenant's digits.
    await expect(cell('examTemplates.grid.columnFull', 2)).toHaveValue(/^(30|৩০)$/);
  });

  await test.step('Esc leaves the field; the header Discard drops an unsaved extra row', async () => {
    await cell('examTemplates.grid.columnPass', 2).focus();
    await page.keyboard.press('Enter');
    await expect(cell('examTemplates.grid.columnName', 3)).toBeFocused();
    await page.keyboard.type('Temp');
    await page.keyboard.press('Escape');
    // Esc must not throw the draft away silently.
    await expect(cell('examTemplates.grid.columnName', 3)).toHaveValue('Temp');
    await page.getByRole('button', { name: t('examTemplates.detail.discard') }).focus();
    await page.keyboard.press('Enter');
    await expect(cell('examTemplates.grid.columnName', 3)).toHaveCount(0);
    await expect(cell('examTemplates.grid.columnName', 2)).toHaveValue('MCQ');
  });

  await test.step('palette -> Create exam from template -> dialog opens', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    await page.keyboard.type('টেমপ্লেট থেকে পরীক্ষা তৈরি করুন'); // action-registry label (no catalog)
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/exams\?create=1$/);
    await expect(page.getByRole('textbox', { name: t('exams.examForm.nameLabel') })).toBeFocused();
  });

  await test.step('fill year, class and "Start from template", submit', async () => {
    await page.keyboard.type(examName);
    await tabUntilFocused(page, t('exams.examForm.academicYearLabel'), 5);
    await selectByTypeahead(page, yearName);
    await tabUntilFocused(page, t('exams.examForm.classLabel'), 3);
    // The class list loads once a year is chosen.
    await expect(
      page.getByRole('combobox', { name: t('exams.examForm.classLabel') }),
    ).toBeFocused();
    await selectByTypeahead(page, className);
    await tabUntilFocused(page, t('examsTemplateField.label'), 3);
    await selectByTypeahead(page, templateName);
    await tabUntilFocused(page, t('exams.examForm.save'), 5, { tag: 'BUTTON' });
    const createdExam = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/v1/exams'),
    );
    await page.keyboard.press('Enter');
    const response = await createdExam;
    expect(response.ok(), await response.text()).toBe(true);
    expect(((await response.json()) as { components_created: number }).components_created).toBe(2);
  });

  await test.step('the success toast reports both components', async () => {
    // i18next cannot plural here (`t()` is a plain lookup): `_other` = count 2.
    await expect(
      page.getByText(t('examsTemplateField.toast.created_other', { count: 2, n: 2 })),
    ).toBeVisible();
  });
});
