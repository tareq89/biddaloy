import { adminApiSession, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage, DetailShellPage } from '../pages';

/**
 * [16.4.6] Journey: Record Payment, through the real modal
 * (`record-payment-modal.tsx`) reached from the student detail page.
 *
 * Two flows:
 *  1. A partial checkout across two bills — the amount received covers
 *     the first bill fully and part of the second — then a second, CASH
 *     top-up payment over-tenders and credits the change to the wallet
 *     (this journey's wallet-balance top-up scenario — `TenderSection`,
 *     `record-payment-modal.tsx`'s tendered/change-to-wallet fields, is
 *     CASH-only; a non-cash method hides them entirely).
 *  2. A checkout on a different, non-cash method (bKash — this journey's
 *     "varied methods" coverage) that discounts a bill enough to need
 *     approval (`fees.discount` scope) — the step-up modal appears
 *     mid-submit, completing it settles the payment.
 */

test.use(loggedIn('accountant'));

async function seedStudentWithTwoBills(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  fullName: string,
  amounts: [number, number],
) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const year = await post<{ id: string }>(request, session, '/academic-years', {
    name: `Checkout E2E Year ${suffix}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  const klass = await post<{ id: string }>(request, session, '/classes', {
    name: `Checkout E2E Class ${suffix}`.slice(0, 50),
    academic_year_id: year.id,
  });
  const section = await post<{ id: string }>(request, session, `/classes/${klass.id}/sections`, {
    section_name: 'A',
  });
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: section.id,
  });
  const feeStructures = await Promise.all(
    amounts.map((amount, index) =>
      post<{ id: string }>(request, session, '/fee-structures', {
        fee_type: 'MONTHLY_TUITION',
        name: `Checkout E2E Fee ${index} ${suffix}`,
        amount,
        class_id: klass.id,
        academic_year_id: year.id,
      }),
    ),
  );
  await post(request, session, '/fees/generate', {
    academic_year_id: year.id,
    period_start: '2026-01-01',
    period_type: 'MONTH',
    student_ids: [student.id],
    fee_structure_ids: feeStructures.map((fee) => fee.id),
    notify_families: false,
  });
  return { studentId: student.id };
}

test('a partial checkout across two bills leaves a balance, then a CASH top-up credits the wallet', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Checkout Student ${Date.now()}`;
  const { studentId } = await seedStudentWithTwoBills(request, session, name, [500, 800]);

  const detail = new DetailShellPage(page);
  await page.goto(`/students/${studentId}`);
  await detail.expectLoaded(name);
  await detail.openTab('students.detail.tabs.fees', 'fees');
  await page
    .getByRole('button', { name: t('students.detail.fees.recordPayment') })
    .first()
    .click();

  await expect(page.getByRole('dialog', { name: t('payments.record.title') })).toBeVisible();
  // 500 fully covers the first bill, 300 of it lands on the second.
  await page.getByLabel(t('payments.record.amountReceived.label')).fill('800');
  // Not `getByLabel`: the Bangla translation for "Cash" ("নগদ") is the
  // exact same string as the "NAGAD" mobile-wallet method's own (untrans-
  // lated, proper-noun) label — two radios share one accessible name.
  // `[value=]` matches `RadioGroupItem value={method}` directly.
  await expect(page.locator('button[role="radio"][value="CASH"]')).toBeChecked();

  // The 300ms-debounced "Amount received" refetches the cart and
  // auto-allocates it across the open bills (`record-payment-modal.tsx`'s
  // own `debouncedAmountReceivedMinorUnits`) — `canSubmit` stays false
  // until that lands, same reasoning `record-payment-modal.test.tsx`'s
  // own tests wait on the "Pay" input's value rather than clicking
  // straight through.
  const submitButton = page.getByRole('button', { name: t('payments.record.submitAction') });
  await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  await submitButton.click();
  await expect(page.getByText(t('payments.record.success.title'))).toBeVisible();

  const duesBefore = await get<{
    data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
  }>(request, session, `/fees/dues?search=${encodeURIComponent(name)}`);
  const remainingBill = duesBefore.data
    .find((row) => row.student_id === studentId)
    ?.dues.find((due) => due.balance > 0);
  if (!remainingBill) throw new Error('Expected the second bill to still owe a balance.');
  expect(remainingBill.balance).toBe(500);

  // Wallet-balance top-up: a second CASH payment tenders more than the
  // remaining bill needs, with the change credited to the wallet instead
  // of returned. The modal doesn't close on success — it swaps to the
  // success panel in place (`record-payment-modal.tsx`) — so the next
  // payment starts from that panel's own "Record another" button, not
  // the page's "Record payment" button sitting behind the still-open
  // dialog's overlay.
  await page.getByRole('button', { name: t('payments.record.success.recordAnother') }).click();
  await expect(page.getByRole('dialog', { name: t('payments.record.title') })).toBeVisible();
  await page.getByLabel(t('payments.record.amountReceived.label')).fill('500');
  await page.getByLabel(t('payments.record.tender.tenderedLabel')).fill('600');
  await page.getByLabel(t('payments.record.tender.changeToWallet')).check();
  const topUpSubmit = page.getByRole('button', { name: t('payments.record.submitAction') });
  await expect(topUpSubmit).toBeEnabled({ timeout: 10_000 });
  await topUpSubmit.click();
  await expect(page.getByText(t('payments.record.success.title'))).toBeVisible();

  const cartAfter = await get<{ students: { id: string; wallet_balance: number }[] }>(
    request,
    session,
    `/payments/cart?student_ids=${studentId}`,
  );
  expect(cartAfter.students.find((s) => s.id === studentId)?.wallet_balance).toBe(100);
});

async function seedStudentWithOneBill(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  fullName: string,
  amount: number,
) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const year = await post<{ id: string }>(request, session, '/academic-years', {
    name: `Checkout Discount E2E Year ${suffix}`,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  const klass = await post<{ id: string }>(request, session, '/classes', {
    name: `Checkout Discount E2E Class ${suffix}`.slice(0, 50),
    academic_year_id: year.id,
  });
  const section = await post<{ id: string }>(request, session, `/classes/${klass.id}/sections`, {
    section_name: 'A',
  });
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: section.id,
  });
  const feeStructure = await post<{ id: string }>(request, session, '/fee-structures', {
    fee_type: 'MONTHLY_TUITION',
    name: `Checkout Discount E2E Fee ${suffix}`,
    amount,
    class_id: klass.id,
    academic_year_id: year.id,
  });
  await post(request, session, '/fees/generate', {
    academic_year_id: year.id,
    period_start: '2026-01-01',
    period_type: 'MONTH',
    student_ids: [student.id],
    fee_structure_ids: [feeStructure.id],
    notify_families: false,
  });
  return { studentId: student.id };
}

test('a discounted bKash checkout needs step-up approval, then settles', async ({
  page,
  request,
}) => {
  // `ApprovalModalPage.complete` waits out `OtpService`'s 60s-per-
  // identifier cooldown when a resend is needed — see `step-up.spec.ts`'s
  // own comment on the same thing. Overruns Playwright's 30s default.
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  const name = `Checkout Discount Student ${Date.now()}`;
  const { studentId } = await seedStudentWithOneBill(request, session, name, 1000);

  const detail = new DetailShellPage(page);
  await page.goto(`/students/${studentId}`);
  await detail.expectLoaded(name);
  await detail.openTab('students.detail.tabs.fees', 'fees');
  await page
    .getByRole('button', { name: t('students.detail.fees.recordPayment') })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: t('payments.record.title') })).toBeVisible();

  // Unlock the discount cell and discount enough of the 1000 bill to
  // require approval, paying the rest (500) via bKash — the "Tendered"/
  // change-to-wallet fields (`TenderSection`) only render for CASH, so a
  // non-cash method here means no tender step, just a reference number.
  //
  // Order matters: `DiscountCell.commit` clamps to `balance - pay`, so the
  // discount is typed once Pay shows the 500 split out of "Amount
  // received". That split arrives with a debounced `GET /payments/cart`
  // (`record-payment-modal.tsx`'s `debouncedAmountReceivedMinorUnits`):
  // wait for that exact response, then for Pay to show it. MoneyInput
  // renders the locale's own digits (e.g. "৳৫০০.০০" in Bangla), so the
  // non-zero check accepts Bengali digits too.
  const cartForAmount = page.waitForResponse(
    (response) =>
      response.url().includes('/payments/cart') &&
      new URL(response.url()).searchParams.get('amount') === '500.00',
  );
  await page.getByLabel(t('payments.record.amountReceived.label')).fill('500');
  await cartForAmount;
  await expect(page.getByLabel(t('payments.record.cart.columnPay'))).toHaveValue(/[1-9১-৯]/);
  await page.getByRole('button', { name: t('payments.record.discount.unlock') }).click();
  await page.getByLabel(t('payments.record.discount.label')).fill('500');
  await page.getByLabel(t('payments.record.method.methods.BKASH')).check();
  await page.getByLabel(t('payments.record.method.referenceLabel')).fill('BKASH-TXN-1');

  const discountSubmit = page.getByRole('button', { name: t('payments.record.submitAction') });
  await expect(discountSubmit).toBeEnabled({ timeout: 10_000 });
  const checkoutRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().includes('/payments/checkout'),
  );
  await discountSubmit.click();
  expect((await checkoutRequest).postDataJSON().lines).toEqual([
    expect.objectContaining({ amount: 500, one_off_discount: 500 }),
  ]);

  // Discount above the threshold trips APPROVAL_REQUIRED — the step-up
  // modal appears mid-submit (`useApprovedMutation`, same contract
  // `-reverse-payment-dialog.test.tsx` exercises at the component level).
  await new ApprovalModalPage(page).complete('admin@biddaloy.test');

  await expect(page.getByText(t('payments.record.success.title'))).toBeVisible();

  const dues = await get<{
    data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
  }>(request, session, `/fees/dues?search=${encodeURIComponent(name)}`);
  const remaining = dues.data.find((row) => row.student_id === studentId)?.dues ?? [];
  expect(remaining.every((due) => due.balance === 0)).toBe(true);
});
