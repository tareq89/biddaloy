import { adminApiSession, createStudentWithDues, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';

/**
 * [68.0 / #2279] Journeys: the two student Fees-tab corrections.
 *  - MON-08: write off an open bill (`write-off-bill-dialog.tsx`) -> step-up -> bill is WAIVED.
 *  - MON-09: pay out wallet credit (`wallet-payout-dialog.tsx`) -> step-up -> balance 0 and a
 *    "Paid out" ledger row.
 * Step-up handling cloned from `reversal.spec.ts`.
 */

// Write-off needs FEE_APPROVE and payout needs PAYMENT_REVERSE; the admin seed role has both.
test.use(loggedIn('admin'));

interface DueRow {
  student_id: string;
  dues: { student_fee_id: string; balance: number }[];
}

async function firstDue(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  studentId: string,
  name: string,
) {
  const dues = await get<{ data: DueRow[] }>(
    request,
    session,
    `/fees/dues?search=${encodeURIComponent(name)}`,
  );
  const due = dues.data.find((row) => row.student_id === studentId)?.dues[0];
  if (!due) throw new Error('No open due for student — seeding failed');
  return due;
}

test('writing off an open bill through the step-up dialog marks it WAIVED', async ({
  page,
  request,
}) => {
  // `ApprovalModalPage.complete` can wait out the OTP cooldown (see reversal.spec.ts).
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  const name = `Write-off Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name, { amount: 800 });
  const due = await firstDue(request, session, studentId, name);

  await page.goto(`/students/${studentId}?tab=fees`);
  await page.getByRole('button', { name: /E2E Tuition/ }).click();
  await page.getByRole('radio', { name: t('students.detail.fees.writeOff.fullLabel') }).check();
  await page
    .getByLabel(t('students.detail.fees.writeOff.reasonLabel'))
    .fill('e2e: write-off journey proof');
  await page.getByRole('button', { name: t('students.detail.fees.writeOff.confirm') }).click();

  await new ApprovalModalPage(page).complete('admin@biddaloy.test');

  // The dialog closes and the open-bills table refreshes without a reload.
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(t('students.detail.fees.emptyMessage'))).toBeVisible();

  const summary = await get<{ fee_breakdown: { id: string; status: string }[] }>(
    request,
    session,
    `/payments/invoices/student/${studentId}`,
  );
  expect(summary.fee_breakdown.find((fee) => fee.id === due.student_fee_id)?.status).toBe('WAIVED');
});

test('paying out wallet credit through the step-up dialog empties the balance and logs a row', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  const name = `Payout Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name, { amount: 500 });
  const due = await firstDue(request, session, studentId, name);

  // Overpay at checkout and credit the change (200) to the wallet.
  await post(request, session, '/payments/checkout', {
    idempotency_key: crypto.randomUUID(),
    lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
    payment_method: 'CASH',
    tendered_amount: due.balance + 200,
    change_handling: 'TO_WALLET',
  });

  await page.goto(`/students/${studentId}?tab=fees`);
  await page.getByRole('tab', { name: t('students.detail.fees.walletTab'), exact: true }).click();
  await page.getByRole('button', { name: t('students.detail.fees.payout.action') }).click();
  await page
    .getByLabel(t('students.detail.fees.payout.reasonLabel'))
    .fill('e2e: payout journey proof');
  await page.getByRole('button', { name: t('students.detail.fees.payout.confirm') }).click();

  await new ApprovalModalPage(page).complete('admin@biddaloy.test');

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(t('common.walletTransactionKind.DEBIT_PAYOUT'))).toBeVisible();
  await expect(
    page.getByRole('button', { name: t('students.detail.fees.payout.action') }),
  ).toBeHidden();

  const wallet = await get<{ balance: number | string }>(
    request,
    session,
    `/students/${studentId}/wallet`,
  );
  expect(Number(wallet.balance)).toBe(0);
});
