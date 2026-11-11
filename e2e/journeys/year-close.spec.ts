import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';

import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage, DetailShellPage } from '../pages';
import { SEED_ROLE_EMAILS } from '../seed-contract';

/**
 * [69.4.99] Wave-close proof of "Close year" on the built app.
 *
 * ```mermaid
 * flowchart LR
 *   A[open year with an exam + marks grid] --> B[Close year dialog: Exams 1]
 *   B --> C[step-up approval OTP]
 *   C --> D["Closed on" badge]
 *   D --> E[marks grid: notice, read-only cells, no Submit]
 *   D --> F[API write into the year: 409 ACADEMIC_YEAR_CLOSED]
 *   D --> G[Reopen year: badge gone, grid editable again]
 * ```
 *
 * The year is a fresh far-future, non-current year this spec alone creates. Closing needs the
 * same approval-OTP flow `step-up.spec.ts` and the promotion commit already use
 * (`ApprovalModalPage`), which waits out OtpService's 60s per-identifier cooldown.
 */
const YEAR = 2200 + Math.floor(Math.random() * 6000);

test.use(loggedIn('admin'));

test('close a year with approval, see it frozen on the marks grid, reopen it', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  const session = await adminApiSession(request);
  const bounds = { start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31` };
  const chain = await createClassSection(request, session, bounds);
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `E2EYC-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Close Subject',
    name_bn: 'ই২ই সমাপ্তি বিষয়',
  });
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: `E2E Close Exam ${Date.now()}`,
    kind: ExamKind.TERM,
    academic_year_id: chain.academicYearId,
    class_id: chain.classId,
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
  const student = await post<{ id: string; full_name: string }>(request, session, '/students', {
    full_name: `E2E Close Student ${Date.now()}`,
    class_section_id: chain.sectionId,
  });
  const year = await (
    await request.get(`/api/v1/academic-years/${chain.academicYearId}`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    })
  ).json();
  const name = (year as { name: string }).name;
  const gridUrl = `/marks/${exam.id}/${chain.sectionId}/${subject.id}`;

  await test.step('open grid is editable and carries no closed notice', async () => {
    await page.goto(gridUrl);
    await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();
    await expect(page.getByText(t('academicYears.closedNotice.text', { name }))).toBeHidden();
  });

  await test.step('Close year: the dialog lists what freezes, approval closes it', async () => {
    await page.goto(`/academic-years/${chain.academicYearId}`);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(name);
    await detail.clickAction('academicYears.closeYear.action');

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: t('academicYears.closeYear.title', { name }) }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        t('academicYears.closeYear.freezeRow', {
          label: t('academicYears.closeYear.freezes.exams'),
          count: 1,
        }),
      ),
    ).toBeVisible();

    // First attempt answers 403 APPROVAL_REQUIRED; the approval modal opens and retries.
    await dialog.getByRole('button', { name: t('academicYears.closeYear.confirm') }).click();
    await new ApprovalModalPage(page).complete(SEED_ROLE_EMAILS.admin);

    await expect(
      page.getByText(t('academicYears.closeYear.closedOn', { date: '' }).trim()),
    ).toBeVisible();
  });

  await test.step('marks grid shows the notice, read-only cells, no Submit', async () => {
    await page.goto(gridUrl);
    await expect(page.getByText(t('academicYears.closedNotice.text', { name }))).toBeVisible();
    const cell = page.getByLabel(
      t('exams.marksGrid.cellLabel', { name: student.full_name, component: 'Written' }),
    );
    await expect(cell).toBeVisible();
    await expect(cell).toBeDisabled();
    await expect(page.getByRole('button', { name: t('exams.submitDialog.confirm') })).toBeHidden();
  });

  await test.step('the server refuses a write into the closed year', async () => {
    const response = await request.patch(`/api/v1/exams/${exam.id}/marks`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      data: {
        section_id: chain.sectionId,
        subject_id: subject.id,
        cells: [
          { student_id: student.id, component_id: component.id, value: '50.00', status: 'PRESENT' },
        ],
      },
    });
    expect(response.status()).toBe(409);
    const body = (await response.json()) as { details?: { code?: string } };
    expect(body.details?.code).toBe('ACADEMIC_YEAR_CLOSED');
  });

  await test.step('Reopen year: the badge goes and the grid is editable again', async () => {
    await page.goto(`/academic-years/${chain.academicYearId}`);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(name);
    await detail.clickAction('academicYears.closeYear.reopenAction');
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('academicYears.closeYear.reopenConfirm') })
      .click();
    // Reopen is step-up too: the first attempt answers 403 APPROVAL_REQUIRED and the modal retries.
    await new ApprovalModalPage(page).complete(SEED_ROLE_EMAILS.admin);
    await expect(
      page.getByText(t('academicYears.closeYear.closedOn', { date: '' }).trim()),
    ).toBeHidden();

    await page.goto(gridUrl);
    await expect(page.getByText(t('academicYears.closedNotice.text', { name }))).toBeHidden();
    await expect(
      page.getByLabel(
        t('exams.marksGrid.cellLabel', { name: student.full_name, component: 'Written' }),
      ),
    ).toBeEnabled();
  });
});
