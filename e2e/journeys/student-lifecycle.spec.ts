import { adminApiSession, createClassSection, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [68.4.12] LIFE-16 (UI half): recording a leave while a bill is still due after the leave date
 * keeps the dialog open on a result step that lists the bill; "Open Fees tab" lands on the Fees tab.
 * The leave is dated today (the dialog default), so the spec bills its own student for next month.
 * It does not use a seeded lifecycle student: keyboard/student-lifecycle.spec.ts withdraws and
 * readmits that one, and the two specs ran into each other in parallel.
 */

interface Fee {
  fee_structure: { name: string };
  due_date: string | null;
  status: string;
}

test.describe('student lifecycle: bills after the leave date', () => {
  test.use(loggedIn('admin'));

  test('result step lists a bill due after the leave date and opens the Fees tab', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    const student = await post<{ id: string }>(request, session, '/students', {
      full_name: `Leaver ${Date.now()}`,
      class_section_id: chain.sectionId,
    });
    const feeName = `E2E Next Month ${Date.now()}`;
    const fee = await post<{ id: string }>(request, session, '/fee-structures', {
      fee_type: 'MONTHLY_TUITION',
      name: feeName,
      amount: 500,
      class_id: chain.classId,
      academic_year_id: chain.academicYearId,
    });
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await post(request, session, '/fees/generate', {
      academic_year_id: chain.academicYearId,
      period_start: nextMonth.toISOString().slice(0, 10),
      period_type: 'MONTH',
      student_ids: [student.id],
      fee_structure_ids: [fee.id],
      notify_families: false,
    });
    const summary = await get<{ fee_breakdown: Fee[] }>(
      request,
      session,
      `/payments/invoices/student/${student.id}`,
    );
    const today = now.toISOString().slice(0, 10);
    expect(
      summary.fee_breakdown.some((f) => f.due_date !== null && f.due_date > today),
      'next month bill is due after today',
    ).toBe(true);

    await page.goto(`/students/${student.id}`);
    await page.getByRole('button', { name: t('students.detail.actions.recordLeaving') }).click();
    const dialog = page.getByRole('dialog', { name: t('student-lifecycle.leave.title') });
    await dialog.getByLabel(t('student-lifecycle.leave.reasonLabel')).fill('Moved away');
    await dialog.getByRole('button', { name: t('student-lifecycle.leave.confirm') }).click();

    // The same dialog switches to its result step, which has its own title.
    const result = page.getByRole('dialog', { name: t('student-lifecycle.leave.result.title') });
    await expect(result).toBeVisible();
    await expect(result.getByText(feeName)).toBeVisible();

    await result
      .getByRole('button', { name: t('student-lifecycle.leave.result.openFees') })
      .click();
    await expect(page).toHaveURL(/tab=fees/);
    await expect(page.getByText(feeName).first()).toBeVisible();
  });
});
