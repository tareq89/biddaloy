import {
  adminApiSession,
  createClassSection,
  createFineRule,
  createFineStructure,
  currentAcademicYear,
  get,
  logFine,
  markAbsentDaysInPreviousMonth,
  parentApiSession,
  post,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages';

/**
 * [38.5.1] The epic's cross-role money proof: an ATTENDANCE_ABSENT
 * `FineRule` + 3 absent days last month -> the accountant sweeps the
 * month from `/fees/fines` -> the fine shows up as a due on the student ->
 * Record Payment pays it off -> the guardian's portal no longer lists it.
 *
 * Split into `test.describe.serial` legs (same shape
 * `journeys/attendance.spec.ts` uses for its own cross-role proof): the
 * portal leg needs the seeded PARENT's own browser session
 * (`test.use(loggedIn('parent'))`), which can't share a worker-fixture
 * role with the accountant leg that drives the UI sweep + payment.
 */

test.describe.serial('fines: rule -> sweep -> dues -> payment -> portal', () => {
  let studentId: string;
  let studentFullName: string;
  let fineFeeName: string;

  test.describe('1. accountant sweeps the month and pays the resulting due', () => {
    test.use(loggedIn('accountant'));

    test('Generate fines bills the 3 absences, Record Payment settles it', async ({
      page,
      request,
    }) => {
      const adminSession = await adminApiSession(request);
      // Fresh login independent of this test's own (accountant) browser
      // storage state — see `parentApiSession`'s own doc comment. Resolves
      // the seeded parent's real `Guardian` id so leg 4 below (a genuinely
      // different browser session) can see this same student.
      const parentSession = await parentApiSession(request);
      const guardian = await get<{ id: string }>(request, parentSession, '/guardians/mine');

      // The seeded current year, not a fresh one: the sweep finds its year by
      // date, and a second year covering the same month would make that pick
      // arbitrary (it would bill the seeded rule instead of this spec's).
      const academicYear = await currentAcademicYear(request, adminSession);
      const chain = await createClassSection(request, adminSession, academicYear);
      studentFullName = `E2E Fines Journey Student ${Date.now()}`;
      const student = await post<{ id: string }>(request, adminSession, '/students', {
        full_name: studentFullName,
        class_section_id: chain.sectionId,
        guardian_ids: [guardian.id],
      });
      studentId = student.id;

      fineFeeName = `E2E Absence Fine ${Date.now()}`;
      const fineStructure = await createFineStructure(
        request,
        adminSession,
        chain,
        fineFeeName,
        50,
      );
      await createFineRule(request, adminSession, {
        academic_year_id: chain.academicYearId,
        // A class rule beats the seeded school-wide one for this class, so only
        // this spec's 3 x 50 bills — not the seeded free-1 rule as well.
        class_id: chain.classId,
        trigger: 'ATTENDANCE_ABSENT',
        fee_structure_id: fineStructure.id,
        free_per_period: 0,
        conditions: {},
      });

      const absentDates = await markAbsentDaysInPreviousMonth(
        request,
        adminSession,
        chain.sectionId,
        studentId,
        3,
        academicYear,
      );
      const previousMonthValue = absentDates[0]!.slice(0, 7);

      await test.step('Generate fines for the previous month, scoped to this class', async () => {
        await page.goto('/fees/fines');
        await page.getByRole('button', { name: t('fines.generate.title') }).click();

        const dialog = page.getByRole('dialog', { name: t('fines.generate.title') });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel(t('fines.generate.monthLabel')).fill(previousMonthValue);

        await dialog.getByLabel(t('fines.generate.classLabel')).click();
        await page.getByRole('option', { name: chain.className }).click();

        // No prior fines for this month/class -> `GenerateFinesModal`'s own
        // `handleSubmit` sees zero duplicates on the preview and
        // auto-advances straight to the real generate call, closing the
        // dialog on success — there's no separate "confirm" click to make
        // in this no-duplicate path.
        const submitButton = dialog.getByRole('button', { name: t('fines.generate.submitAction') });
        await submitButton.click();
        await expect(dialog).toBeHidden({ timeout: 15_000 });
      });

      await test.step('the fine shows up as a due on the student', async () => {
        await page.goto(`/students/${studentId}`);
        const detail = new DetailShellPage(page);
        await detail.expectLoaded(studentFullName);
        await detail.openTab('students.detail.tabs.fees', 'fees');
        await expect(page.getByText(fineFeeName)).toBeVisible();
      });

      await test.step('Record Payment pays it in full', async () => {
        await page
          .getByRole('button', { name: t('students.detail.fees.recordPayment') })
          .first()
          .click();
        await expect(page.getByRole('dialog', { name: t('payments.record.title') })).toBeVisible();

        // 3 absences x 50 per `createFineStructure` above.
        await page.getByLabel(t('payments.record.amountReceived.label')).fill('150');
        const submitPayment = page.getByRole('button', { name: t('payments.record.submitAction') });
        await expect(submitPayment).toBeEnabled({ timeout: 10_000 });
        await submitPayment.click();
        await expect(page.getByText(t('payments.record.success.title'))).toBeVisible();
      });
    });
  });

  test.describe('2. the guardian no longer sees the (now paid) fine on the portal', () => {
    test.use(loggedIn('parent'));

    test('the paid fine has dropped off the "Due this month" card', async ({ page }) => {
      await page.goto('/portal');
      await expect(page.getByText(t('portal.fees.dueThisMonth')).first()).toBeVisible();
      await expect(page.getByText(fineFeeName)).toHaveCount(0);
    });
  });
});

test('a manual damage fine logged twice in one month creates two separate lines', async ({
  request,
}) => {
  // API-only: `LogFineModal`'s own submit path is already exercised end to
  // end by `keyboard/fines.spec.ts`'s (a)/(c) — this proves the *data*
  // shape (one `StudentFee` row per log, not a merged/incremented one),
  // which doesn't need a second UI drive to prove.
  const session = await adminApiSession(request);
  const chain = await createClassSection(request, session);
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: `E2E Damage Fine Student ${Date.now()}`,
    class_section_id: chain.sectionId,
  });
  const fineStructure = await createFineStructure(
    request,
    session,
    chain,
    `E2E Damage Fine ${Date.now()}`,
    30,
  );
  const incidentDate = new Date().toISOString().slice(0, 10);

  await logFine(request, session, {
    student_ids: [student.id],
    fee_structure_id: fineStructure.id,
    note: 'Broke a window pane',
    incident_date: incidentDate,
    notify_families: false,
  });
  await logFine(request, session, {
    student_ids: [student.id],
    fee_structure_id: fineStructure.id,
    note: 'Broke another window pane',
    incident_date: incidentDate,
    notify_families: false,
  });

  const fines = await get<{ items: { id: string }[]; total: number }>(
    request,
    session,
    `/fees/fines?student_id=${student.id}&fee_structure_id=${fineStructure.id}`,
  );
  expect(fines.total).toBe(2);
  expect(new Set(fines.items.map((fine) => fine.id)).size).toBe(2);
});
