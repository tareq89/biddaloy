import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, ensureGradingScale, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

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
  await ensureGradingScale(request, session, academicYearId);

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
  // Result processing only counts subjects assigned to the class; without
  // this the student gets an empty result that neither fails nor is absent.
  for (const subject of [failedSubject, absentSubject]) {
    await post(request, session, `/classes/${classId}/subjects`, {
      subject_id: subject.id,
      academic_year_id: academicYearId,
    });
  }

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

  // Controls are reached with `.focus()` and driven with real keys rather
  // than by counting Tab presses through the sidebar — see
  // `command-palette.spec.ts` for why a Tab count is environment-dependent.
  await test.step('open Analysis from the nav, keyboard only', async () => {
    await page
      .getByRole('navigation')
      .getByRole('link', { name: t('nav.items.analysis'), exact: true })
      .focus();
    await page.keyboard.press('Enter');
    // `useRouteFocus` focuses the new page's <h1> once the navigation and
    // its view transition settle — the signal that the page is ready.
    await expect(page.getByRole('heading', { level: 1, name: t('nav.items.analysis') })).toBeFocused();
  });

  await test.step('pick the seeded exam and section', async () => {
    await page.getByRole('combobox', { name: t('exams.resultsRoute.examLabel') }).focus();
    await selectByTypeahead(page, examName);

    // Only one section ("A") exists on this fresh class.
    await page.getByRole('combobox', { name: t('exams.analysis.sectionFilter') }).focus();
    await selectByTypeahead(page, 'A');
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

    // A Radix checkbox is a <button> named by its sibling label, so
    // `tabUntilFocused`'s text match can't see it — focus it by role.
    await page.getByRole('checkbox', { name: t('exams.analysis.byComponent') }).focus();
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
