import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordPaymentModal } from './record-payment-modal';

// `RecordPaymentModal` is rendered directly (not through a routed page,
// per `generate-fees-modal.test.tsx`'s own precedent) so its success
// handler's `navigate({ to: '/invoices/$invoiceId' })` — [16.5.5]'s
// stopgap — has no real `RouterProvider` to call into here. Mocked to a
// no-op rather than exercised: the router itself isn't this ticket's
// concern, and the real navigation target is already asserted for
// `/payments/record` elsewhere (`route-permissions.test.ts`'s siblings).
//
// `navigateMock` is hoisted out of the factory (rather than a fresh
// `vi.fn()` per call, which no test could assert against) so a test can
// verify the success view stays put — `onOpenChange(false)` alone doesn't
// prove that, since a component could stop calling it for unrelated
// reasons while still navigating away.
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

function bill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    student_fee_id: 'fee-1',
    fee_name: 'Tuition — March',
    fee_type: 'TUITION',
    period_start: '2026-03-01',
    period_type: 'MONTH',
    occurrence: 1,
    total_amount: 5000,
    standing_discount_amount: 0,
    one_off_discount_amount: 0,
    paid_amount: 0,
    balance: 5000,
    due_date: '2026-03-10',
    is_late_fee: false,
    is_overdue: false,
    suggested_allocation: 5000,
    ...overrides,
  };
}

function cartResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    students: [
      {
        id: 'student-1',
        full_name: 'Rahim Uddin',
        registration_number: 'R-1',
        class_name: 'Six',
        section_name: 'A',
        wallet_balance: 0,
        bills: [bill()],
      },
    ],
    total_balance: 5000,
    suggested: {
      allocations: [{ student_fee_id: 'fee-1', amount: 5000 }],
      wallet_used: 0,
      remaining: 0,
      to_wallet: 0,
    },
    ...overrides,
  };
}

function approvalRequiredBody() {
  return HttpResponse.json(
    {
      statusCode: 403,
      message: 'Approval required',
      timestamp: new Date().toISOString(),
      path: '/payments/checkout',
      requestId: 'req-1',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
}

async function renderModal(props: { studentId?: string; guardianId?: string } = {}) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <RecordPaymentModal open onOpenChange={onOpenChange} {...props} />,
    { tenantId: 'tenant-1', role: 'ACCOUNTANT', locale: 'en' },
  );
  await view.localeReady;
  return { ...view, onOpenChange };
}

describe('RecordPaymentModal', () => {
  afterEach(async () => {
    navigateMock.mockClear();
    await cleanupTestState();
  });

  it('[16.4.4] pre-selects a deep-linked student and hides the search box', async () => {
    server.use(http.get('/api/v1/payments/cart', () => HttpResponse.json(cartResponse())));

    await renderModal({ studentId: 'student-1' });

    await screen.findByText('Tuition — March');
    expect(screen.queryByPlaceholderText('Search by name or roll number')).toBeNull();
  });

  it('[16.4.4] pre-selects every linked child for a guardian entry point', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json({
          id: 'g-1',
          full_name: 'Karim Ahmed',
          students: [
            { id: 'student-1', full_name: 'Rahim Uddin' },
            { id: 'student-2', full_name: 'Fatema Begum' },
          ],
        }),
      ),
      http.get('/api/v1/payments/cart', ({ request }) => {
        const ids = new URL(request.url).searchParams.get('student_ids');
        return HttpResponse.json(
          cartResponse({
            students: (ids ?? '').split(',').map((id) => ({
              id,
              full_name: id,
              registration_number: id,
              class_name: 'Six',
              section_name: 'A',
              wallet_balance: 0,
              bills: [bill({ student_fee_id: `${id}-fee` })],
            })),
          }),
        );
      }),
    );

    await renderModal({ guardianId: 'g-1' });

    await waitFor(() => expect(screen.getAllByText(/Tuition/)).toHaveLength(2));
  });

  it('[16.4.4] distributes the amount received oldest-first into the Pay inputs', async () => {
    let lastAmount: string | null = null;
    server.use(
      http.get('/api/v1/payments/cart', ({ request }) => {
        lastAmount = new URL(request.url).searchParams.get('amount');
        return HttpResponse.json(cartResponse());
      }),
    );

    await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — March');

    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '1000' } });

    // F1: the `amount` query param is major-unit decimal, matching every
    // other amount field on this same response (bill.balance,
    // suggested_allocation, wallet_balance) — not the minor-unit number
    // typed into the `MoneyInput`. `1000` (major units, i.e. 1,000.00)
    // becomes minor units `100000`, which converts back to `'1000.00'`.
    await waitFor(() => expect(lastAmount).toBe('1000.00'));
    const payInput = screen.getByLabelText<HTMLInputElement>('Pay');
    await waitFor(() => expect(payInput.value).not.toBe(''));
  });

  // Like the real server: `suggested` only comes back when `amount` is sent.
  function cartFor(request: Request, studentIds: string[]) {
    const amount = new URL(request.url).searchParams.get('amount');
    return cartResponse({
      students: studentIds.map((id, index) => ({
        id,
        full_name: id,
        registration_number: id,
        class_name: 'Six',
        section_name: 'A',
        wallet_balance: 0,
        bills: [bill({ student_fee_id: `${id}-fee`, fee_name: `Tuition — ${index + 1}` })],
      })),
      suggested:
        amount === null
          ? undefined
          : {
              allocations: studentIds.map((id) => ({
                student_fee_id: `${id}-fee`,
                amount: Number(amount) / studentIds.length,
              })),
              wallet_used: 0,
              remaining: 0,
              to_wallet: 0,
            },
    });
  }

  it('keeps a discount typed while the new amount’s cart is still loading', async () => {
    let checkoutBody: { lines: unknown[] } | undefined;
    server.use(
      http.get('/api/v1/payments/cart', async ({ request }) => {
        if (new URL(request.url).searchParams.has('amount')) await delay(400);
        return HttpResponse.json(cartFor(request, ['student-1']));
      }),
      http.post('/api/v1/payments/checkout', async ({ request }) => {
        checkoutBody = (await request.json()) as { lines: unknown[] };
        return HttpResponse.json(
          {
            payment: { id: 'payment-1', student: { id: 'student-1', full_name: 'Rahim' }, total_amount: 1000 },
            invoice_id: 'invoice-1',
            invoice_number: 'INV-1',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — 1');

    // Amount, then the discount straight away — inside the amount's 300 ms
    // debounce and the cart request after it.
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '1000' } });
    await user.click(screen.getByRole('button', { name: 'Unlock to edit discount' }));
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '500' } });

    const payInput = screen.getByLabelText<HTMLInputElement>('Pay');
    await waitFor(() => expect(payInput.value).toMatch(/[1-9১-৯]/), { timeout: 2000 });
    const submitButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Record payment' });
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    await user.click(submitButton);

    await waitFor(() => expect(checkoutBody).toBeDefined());
    expect(checkoutBody?.lines).toEqual([
      { student_fee_id: 'student-1-fee', amount: 1000, one_off_discount: 500 },
    ]);
  });

  it('a sibling re-added after edits gets a suggested Pay and no old discount', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json({
          id: 'g-1',
          full_name: 'Karim Ahmed',
          students: [
            { id: 'student-1', full_name: 'Rahim Uddin' },
            { id: 'student-2', full_name: 'Fatema Begum' },
          ],
        }),
      ),
      http.get('/api/v1/payments/cart', ({ request }) => {
        const ids = new URL(request.url).searchParams.get('student_ids') ?? '';
        return HttpResponse.json(cartFor(request, ids.split(',')));
      }),
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [
            {
              id: 'student-2',
              full_name: 'Fatema Begum',
              roll_number: 2,
              class_section: { section_name: 'A', class: { name: 'Six' } },
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal({ guardianId: 'g-1' });
    await screen.findByText('Tuition — 2');

    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '1000' } });
    await waitFor(() =>
      expect(screen.getAllByLabelText<HTMLInputElement>('Pay')[1]?.value).toMatch(/[1-9১-৯]/),
    );
    await user.click(screen.getAllByRole('button', { name: 'Unlock to edit discount' })[1]!);
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '200' } });

    await user.click(screen.getByRole('button', { name: 'Remove Fatema Begum' }));
    await waitFor(() => expect(screen.queryByText('Tuition — 2')).toBeNull());

    await user.type(screen.getByLabelText('Search for a student'), 'Fat');
    await user.click(await screen.findByRole('button', { name: /Fatema Begum/ }));

    await screen.findByText('Tuition — 2');
    await waitFor(() =>
      expect(screen.getAllByLabelText<HTMLInputElement>('Pay')[1]?.value).toMatch(/[1-9১-৯]/),
    );
    expect(screen.getAllByRole('button', { name: 'Unlock to edit discount' })).toHaveLength(2);
    expect(screen.queryByLabelText('Discount')).toBeNull();
  });

  it('[16.4.4] a 403 APPROVAL_REQUIRED → step-up → retry carries the same idempotency key', async () => {
    let firstKey: string | undefined;
    let secondKey: string | undefined;
    let approvalTokenSeen: string | null = null;
    let attempt = 0;

    server.use(
      http.get('/api/v1/payments/cart', () => HttpResponse.json(cartResponse())),
      http.post('/api/v1/payments/checkout', async ({ request }) => {
        attempt += 1;
        const body = (await request.json()) as { idempotency_key: string };
        if (attempt === 1) {
          firstKey = body.idempotency_key;
          return approvalRequiredBody();
        }
        secondKey = body.idempotency_key;
        approvalTokenSeen = request.headers.get('X-Approval-Token');
        return HttpResponse.json(
          {
            payment: {
              id: 'payment-1',
              student: { id: 'student-1', full_name: 'Rahim' },
              total_amount: 1000,
            },
            invoice_id: 'invoice-1',
            invoice_number: 'INV-1',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'token-1', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — March');

    const submitButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Record payment',
    });
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    await user.click(submitButton);

    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(secondKey).toBeDefined());
    expect(secondKey).toBe(firstKey);
    expect(approvalTokenSeen).toBe('token-1');
  });

  it('[16.4.4] Enter inside the reference field does not submit the form', async () => {
    let checkoutCalls = 0;
    server.use(
      http.get('/api/v1/payments/cart', () => HttpResponse.json(cartResponse())),
      http.post('/api/v1/payments/checkout', () => {
        checkoutCalls += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — March');

    await user.click(screen.getByLabelText('Cheque'));
    const referenceField = await screen.findByLabelText('Transaction reference');
    await user.type(referenceField, 'REF-1{Enter}');

    // The stray Enter must not have reached `/payments/checkout` — give
    // any (wrongly) in-flight request a tick to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(checkoutCalls).toBe(0);
  });

  it('[16.5.5] a successful checkout shows the success view, not a navigate-away', async () => {
    server.use(
      http.get('/api/v1/payments/cart', () => HttpResponse.json(cartResponse())),
      http.post('/api/v1/payments/checkout', () =>
        HttpResponse.json(
          {
            payment: {
              id: 'payment-1',
              student: { id: 'student-1', full_name: 'Rahim' },
              total_amount: 5000,
            },
            invoice_id: 'invoice-1',
            invoice_number: 'INV-2026-000123',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — March');

    const submitButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Record payment',
    });
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    await user.click(submitButton);

    await waitFor(() => expect(screen.getByText('INV-2026-000123')).toBeTruthy());
    // The dialog stays open on the success view — `resetAndClose()` (which
    // calls `onOpenChange(false)`) is no longer reached from `onSuccess`.
    // Asserting `onOpenChange` alone wouldn't catch `onSuccess` navigating
    // away instead: the success view (`INV-2026-000123`) is still visible
    // above, and navigation must not have fired either.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('[16.5.5] "Record another" returns to an empty form', async () => {
    server.use(
      http.get('/api/v1/payments/cart', () => HttpResponse.json(cartResponse())),
      http.post('/api/v1/payments/checkout', () =>
        HttpResponse.json(
          {
            payment: {
              id: 'payment-1',
              student: { id: 'student-1', full_name: 'Rahim' },
              total_amount: 5000,
            },
            invoice_id: 'invoice-1',
            invoice_number: 'INV-2026-000123',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    await renderModal({ studentId: 'student-1' });
    await screen.findByText('Tuition — March');

    const submitButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Record payment',
    });
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    await user.click(submitButton);

    await waitFor(() => expect(screen.getByText('INV-2026-000123')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Record another' }));

    // Back on the form, with the amount-received field cleared.
    expect(screen.getByText('Record a payment')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Amount received').value).toBe('');
  });
});
