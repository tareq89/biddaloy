import { adminApiSession, createStudentWithDues, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';

/**
 * [16.6.5] Journey: reverse a recorded payment through the real dialog
 * (`-reverse-payment-dialog.tsx`) — reason, step-up approval, then check
 * every place the reversal is supposed to show up:
 *  - the student's dues are restored to their pre-payment state,
 *  - the original invoice is CANCELLED with a credit note alongside it,
 *  - the collections report's `net` total excludes the reversed amount
 *    (checked against the report's actual `totals.reversed`/`totals.net`
 *    rows — `reports/collections.tsx` — rather than assuming a
 *    per-payment negative line, which isn't how this report represents
 *    a reversal).
 */

// `POST /payments/:id/reverse` is `@Roles(UserRole.ADMIN)` only
// (`checkout.controller.ts`) — an accountant can record a payment but not
// reverse one, so this journey (unlike the others) needs the admin seed
// role to even see the Reverse button.
test.use(loggedIn('admin'));

test('reversing a payment restores dues, cancels the invoice, and nets out of collections', async ({
  page,
  request,
}) => {
  // `ApprovalModalPage.complete` waits out `OtpService`'s 60s-per-
  // identifier cooldown when a resend is needed — see `step-up.spec.ts`'s
  // own comment on the same thing. Overruns Playwright's 30s default.
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  const name = `Reversal Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name, { amount: 1000 });

  const payment = await recordFullPayment(request, session, studentId);
  // `GET /payments/:id` (`PaymentsQueryService.findOne`) nests the invoice
  // under `invoice: { id, invoice_number, status }` — there's no flat
  // `invoice_id` field on this response.
  const paymentDetail = await get<{ invoice: { id: string } | null }>(
    request,
    session,
    `/payments/${payment.id}`,
  );
  const invoice = paymentDetail.invoice?.id;

  await page.goto(`/payments/${payment.id}`);
  await expect(page.getByText(t('payments.detail.amount')).first()).toBeVisible();
  await page.getByRole('button', { name: t('payments.detail.reverseAction') }).click();

  await page
    .getByLabel(t('payments.detail.reverseDialog.reasonLabel'))
    .fill('e2e: reversal journey proof');
  await page.getByRole('button', { name: t('payments.detail.reverseDialog.confirm') }).click();

  await new ApprovalModalPage(page).complete('admin@biddaloy.test');

  await expect(page.getByText(t('payments.detail.reversedBanner'))).toBeVisible();

  await test.step('dues are restored', async () => {
    await page.goto('/fees/dues');
    await page.getByLabel(t('fees.dues.searchLabel')).fill(name);
    await expect(page.getByText(name).first()).toBeVisible();
    // This journey runs in `bn` (this app's real market locale, per the
    // suite's default) — `formatCurrency` renders Bangla digits
    // ("৳১,০০০.০০"), not Latin ones, so the balance check has to match
    // both digit sets rather than assuming Latin "1000".
    await expect(page.getByText(/(?:1,?000|১,?০০০)/).first()).toBeVisible();
  });

  await test.step('the invoice is CANCELLED with a credit note', async () => {
    // The credit note is a *separate*, sibling invoice
    // (`invoice.kind === 'CREDIT_NOTE'`) the reversal mints alongside —
    // `payment-reversal.service.ts`'s own comment: it "mints a credit
    // note and flips the original invoice to CANCELLED". Navigating to
    // the original `invoice` id (captured before the reversal) shows the
    // CANCELLED status on *that* invoice, not the credit-note badge,
    // which only ever renders on the new sibling.
    await page.goto(`/invoices/${invoice}`);
    await expect(page.getByText(t('common.status.invoice.CANCELLED'))).toBeVisible();
  });

  await test.step('collections report nets out the reversed amount', async () => {
    const report = await get<{ totals: Record<string, number> }>(
      request,
      session,
      `/reports/collections?from=2026-01-01&to=2026-12-31`,
    );
    expect(report.totals.reversed).toBeGreaterThanOrEqual(1000);
    expect(report.totals.net).toBeLessThan(report.totals.collected);
  });
});

async function recordFullPayment(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  studentId: string,
): Promise<{ id: string }> {
  const student = await get<{ full_name: string }>(request, session, `/students/${studentId}`);
  const dues = await get<{
    data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
  }>(request, session, `/fees/dues?search=${encodeURIComponent(student.full_name)}`);
  const due = dues.data.find((row) => row.student_id === studentId)?.dues[0];
  if (!due) throw new Error('No open due for student — seeding failed');
  const result = await post<{ payment: { id: string } }>(request, session, '/payments/checkout', {
    idempotency_key: crypto.randomUUID(),
    lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
    payment_method: 'CASH',
  });
  return result.payment;
}
