import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordPaymentModal } from './record-payment-modal';

// `RecordPaymentModal` is rendered directly (not through a routed page,
// per `generate-fees-modal.test.tsx`'s own precedent) so its success
// handler's `navigate({ to: '/invoices/$invoiceId' })` — [16.5.5]'s
// stopgap — has no real `RouterProvider` to call into here. Mocked to a
// no-op rather than exercised: the router itself isn't this ticket's
// concern, and the real navigation target is already asserted for
// `/payments/record` elsewhere (`route-permissions.test.ts`'s siblings).
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
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
            payment: { id: 'payment-1' },
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
});
