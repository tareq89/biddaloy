import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [26.8.1] Exams & Results › Analysis, KEYBOARD ONLY — no `page.mouse` and
 * no `.click(` reaches the page itself (the seeding above it is plain API
 * setup, same split every other file in this folder uses).
 *
 * Route: a fresh exam with two subjects — one the seeded student fails,
 * one they're absent for — processed and published through the same
 * `/results/process` + `/results/publish` endpoints `result-publish.spec.ts`
 * ([19.10.1]) already exercises via the UI. That gives the Defaulted tab a
 * real reasons cell (`DefaultedTab` builds it from `failed_subjects` /
 * `absent_subjects`) without guessing at seed data.
 *
 * Tab switching: `AnalysisPage`'s `Tabs` is Radix `Tabs` with roving
 * tabindex — once a `role="tab"` trigger has focus, `ArrowRight` moves to
 * and activates the next tab (default `activationMode="automatic"`). That
 * is exactly the plan's "arrow to Defaulted" step; no click needed.
 */

test.use(loggedIn('admin'));

test('keyboard-only: pick exam and section, arrow to Defaulted, toggle by component, print is reachable', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { academicYearId, classId, sectionId } = await createClassSection(request, session);

  const student = await post<{ id: string; roll_number: number; full_name: string }>(
    request,
    session,
    '/students',
    { full_name: `E2E Analysis Student ${Date.now()}`, class_section_id: sectionId },
  );

  const examName = `E2E Analysis Exam ${Date.now()}`;
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: examName,
    kind: ExamKind.TERM,
    academic_year_id: academicYearId,
    class_id: classId,
  });

  const failedSubject = await post<{ id: string; name_en: string }>(request, session, '/subjects', {
    code: `E2EAF-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Failed Subject',
    name_bn: 'ই২ই অকৃতকার্য বিষয়',
  });
  const absentSubject = await post<{ id: string; name_en: string }>(request, session, '/subjects', {
    code: `E2EAA-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Absent Subject',
    name_bn: 'ই২ই অনুপস্থিত বিষয়',
  });

  const failedComponent = await post<{ id: string }>(
    request,
    session,
    `/exams/${exam.id}/components`,
    {
      subject_id: failedSubject.id,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100.00',
      pass_marks: '33.00',
      sequence: 1,
    },
  );
  const absentComponent = await post<{ id: string }>(
    request,
    session,
    `/exams/${exam.id}/components`,
    {
      subject_id: absentSubject.id,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100.00',
      pass_marks: '33.00',
      sequence: 1,
    },
  );

  async function submitMarks(subjectId: string, cells: unknown[]) {
    const response = await request.patch(`/api/v1/exams/${exam.id}/marks`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      data: { section_id: sectionId, subject_id: subjectId, cells },
    });
    if (!response.ok()) {
      throw new Error(`PATCH marks failed: ${response.status()} ${await response.text()}`);
    }
    await post(request, session, `/exams/${exam.id}/marks/submit`, {
      section_id: sectionId,
      subject_id: subjectId,
    });
  }

  await submitMarks(failedSubject.id, [
    { student_id: student.id, component_id: failedComponent.id, value: '20.00', status: 'PRESENT' },
  ]);
  await submitMarks(absentSubject.id, [
    { student_id: student.id, component_id: absentComponent.id, value: null, status: 'ABSENT' },
  ]);

  await post(request, session, `/exams/${exam.id}/results/process`, {});
  await post(request, session, `/exams/${exam.id}/results/publish`, {});

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open Analysis from the nav, keyboard only', async () => {
    await tabUntilFocused(page, t('nav.items.analysis'), 60, { tag: 'A' });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('nav.items.analysis') })).toBeVisible();
  });

  await test.step('pick the seeded exam and section', async () => {
    await tabUntilFocused(page, t('exams.resultsRoute.examLabel'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await page.keyboard.type(examName);
    await page.keyboard.press('Enter');
    // The trigger's `aria-label` is the field label (`examLabel`), not the
    // selected value, so the real proof this landed is the section select
    // for `selectedExam.class_id` becoming reachable next.
    await expect(page.getByText(examName)).toBeVisible();

    await tabUntilFocused(page, t('exams.analysis.sectionFilter'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    // Only one section ("A") exists on this fresh class — typeahead on
    // its first letter is enough to select it.
    await page.keyboard.type('A');
    await page.keyboard.press('Enter');
  });

  await test.step('arrow from Merit to Defaulted, assert a reason cell', async () => {
    await tabUntilFocused(page, t('exams.analysis.tabs.merit'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('tab', { name: t('exams.analysis.tabs.defaulted') }),
    ).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByText(student.full_name)).toBeVisible();
    await expect(page.getByText(failedSubject.name_en, { exact: false })).toBeVisible();
    await expect(page.getByText(absentSubject.name_en, { exact: false })).toBeVisible();
  });

  await test.step('arrow to Pass/Fail, toggle by component, assert the component table', async () => {
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('tab', { name: t('exams.analysis.tabs.passFail') }),
    ).toHaveAttribute('aria-selected', 'true');

    await tabUntilFocused(page, t('exams.analysis.byComponent'), 30);
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('columnheader', {
        name: t('exams.analysis.passFailComponent.columnComponent'),
      }),
    ).toBeVisible();
  });

  await test.step('the print button is reachable by keyboard', async () => {
    await tabUntilFocused(page, t('exams.analysis.print'), 30, { tag: 'BUTTON' });
    await expect(page.getByRole('button', { name: t('exams.analysis.print') })).toBeFocused();
  });
});
