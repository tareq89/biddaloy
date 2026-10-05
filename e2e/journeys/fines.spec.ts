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

// [31.4] The Record Payment footer primary reads "Record <amount>" (or "Record payment" before any amount), so match the verb (same as checkout.spec.ts).
const RECORD_BUTTON = /রেকর্ড করুন|^Record/;

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

        // The modal already defaults to the previous calendar month; only open
        // the picker when the absences landed in a different month.
        const now = new Date();
        const defaultMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const defaultValue = `${defaultMonth.getFullYear()}-${String(defaultMonth.getMonth() + 1).padStart(2, '0')}`;
        const monthTrigger = dialog.getByLabel(t('fines.generate.monthLabel'));
        const [wantYear, wantMonth] = previousMonthValue.split('-').map(Number) as [number, number];
        if (previousMonthValue !== defaultValue) {
          await monthTrigger.click();
          const popover = page.locator('[data-radix-popper-content-wrapper]');
          for (let year = defaultMonth.getFullYear(); year !== wantYear;) {
            const step = year < wantYear ? 1 : -1;
            await popover
              .getByRole('button', {
                name: t(step > 0 ? 'common.date.nextYear' : 'common.date.previousYear'),
              })
              .click();
            year += step;
          }
          // The twelve month buttons are the only `aria-pressed` buttons in the popover.
          await popover
            .locator('button[aria-pressed]')
            .nth(wantMonth - 1)
            .click();
        }

        await dialog.getByLabel(t('fines.generate.classLabel')).click();
        await page.getByRole('option', { name: chain.className }).click();

        // Always two steps: see what will be made, then make it.
        await dialog.getByRole('button', { name: t('fines.generate.previewAction') }).click();
        await expect(
          dialog.getByRole('heading', { name: t('fines.generate.previewHeading') }),
        ).toBeVisible();
        await dialog.getByRole('button', { name: t('fines.generate.submitAction') }).click();
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
          .getByRole('button', { name: t('students.detail.actions.collectFees') })
          .first()
          .click();
        // [31.4] Record Payment is a full page now, not a dialog.
        await expect(
          page.getByRole('heading', { level: 1, name: t('payments.record.title') }),
        ).toBeVisible();

        // 3 absences x 50 per `createFineStructure` above.
        await page.getByLabel(t('payments.record.amountReceived.label')).fill('150');
        const submitPayment = page.getByRole('button', { name: RECORD_BUTTON });
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
      // [31.4] The child's card hides its "Due this month" section when nothing is
      // due, so wait on the child's own card instead of that heading.
      await expect(page.getByText(studentFullName).first()).toBeVisible();
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
