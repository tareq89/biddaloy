import { adminApiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_LIFECYCLE_STUDENTS } from '../seed-contract';

/**
 * [68.4.12] LIFE-16 (UI half): recording a leave while a bill is still due after the leave date
 * keeps the dialog open on a result step that lists the bill; "Open Fees tab" lands on the Fees tab.
 * The leave is dated today (the dialog default), so the bill must fall due after today. The seeded
 * student may have none, in which case the case skips rather than invents data.
 */

interface StudentRow {
  id: string;
}
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
    const reg = SEED_LIFECYCLE_STUDENTS.withdrawnThenReadmitted;
    const list = await get<{ data: StudentRow[] }>(request, session, `/students?search=${reg}`);
    const student = list.data[0]!;
    const summary = await get<{ fee_breakdown: Fee[] }>(
      request,
      session,
      `/payments/invoices/student/${student.id}`,
    );
    const today = new Date().toISOString().slice(0, 10);
    const bill = summary.fee_breakdown.find(
      (f) =>
        f.due_date !== null &&
        f.due_date > today &&
        ['PENDING', 'PARTIALLY_PAID'].includes(f.status),
    );
    test.skip(!bill, 'seeded student has no unpaid bill due after today');

    await page.goto(`/students/${student.id}?leave=1`);
    const dialog = page.getByRole('dialog', { name: t('student-lifecycle.leave.title') });
    await dialog.getByLabel(t('student-lifecycle.leave.reasonLabel')).fill('Moved away');
    await dialog.getByRole('button', { name: t('student-lifecycle.leave.confirm') }).click();

    await expect(
      dialog.getByRole('heading', { name: t('student-lifecycle.leave.result.title') }),
    ).toBeVisible();
    await expect(dialog.getByText(bill!.fee_structure.name)).toBeVisible();

    await dialog
      .getByRole('button', { name: t('student-lifecycle.leave.result.openFees') })
      .click();
    await expect(page).toHaveURL(/tab=fees/);
    await expect(page.getByText(bill!.fee_structure.name).first()).toBeVisible();
  });
});
