import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, ensureGradingScale, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead } from '../keyboard/keyboard-utils';
import { expectNoHorizontalScroll } from '../pages/assertions';

/**
 * [2593] /analysis at 390px: the result tabs scroll inside their own strip,
 * not the page. The default seed has no processed exam, so the exam is
 * created here.
 */

test.use(loggedIn('admin'));

test('analysis does not scroll sideways at 390px on any tab', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const { academicYearId, classId, sectionId, className } = await createClassSection(
    request,
    session,
  );
  await ensureGradingScale(request, session, academicYearId);

  const stamp = Date.now();
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: `E2E Phone Student ${stamp}`,
    class_section_id: sectionId,
  });
  const examName = `E2E Phone Exam ${stamp}`;
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: examName,
    kind: ExamKind.TERM,
    academic_year_id: academicYearId,
    class_id: classId,
  });
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `E2EPH-${stamp.toString(36).toUpperCase()}`,
    name_en: 'E2E Phone Subject',
    name_bn: 'ই২ই ফোন বিষয়',
  });
  await post(request, session, `/classes/${classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: academicYearId,
  });
  const component = await post<{ id: string }>(request, session, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });
  const marks = await request.patch(`/api/v1/exams/${exam.id}/marks`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    data: {
      section_id: sectionId,
      subject_id: subject.id,
      cells: [
        { student_id: student.id, component_id: component.id, value: '80.00', status: 'PRESENT' },
      ],
    },
  });
  if (!marks.ok()) throw new Error(`PATCH marks failed: ${marks.status()}`);
  await post(request, session, `/exams/${exam.id}/marks/submit`, {
    section_id: sectionId,
    subject_id: subject.id,
  });
  await post(request, session, `/exams/${exam.id}/results/process`, {});
  await post(request, session, `/exams/${exam.id}/results/publish`, {});

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/analysis');
  await page.getByRole('combobox', { name: t('exams.resultsRoute.examLabel') }).focus();
  await selectByTypeahead(
    page,
    t('grading.marksEntry.examOption', { exam: examName, class: className }),
  );

  for (const tab of ['merit', 'defaulted', 'passFail'] as const) {
    await page.getByRole('tab', { name: t(`grading.analysisPage.tabs.${tab}`) }).click();
    await expect(
      page.getByRole('tab', { name: t(`grading.analysisPage.tabs.${tab}`) }),
    ).toHaveAttribute('aria-selected', 'true');
    await expectNoHorizontalScroll(page);
  }
});
