/**
 * [8.10.5]'s full Record Payment loop — real route tree (same reasoning
 * `fees/dues.test.tsx` gives for itself), deep-linked with `student_id`
 * so `FindStudentStep` isn't part of the path under test here.
 */
import {
  cleanupTestState,
  invoiceFactory,
  paymentFactory,
  renderWithRouter,
  server,
  studentFactory,
  studentFeeFactory,
  type Payment,
  type StudentFee,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/payments/record', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // Year 2020 — safely in the past regardless of when the test suite
  // actually runs, so `classifyAllocationType` (which uses the real
  // clock, not a fixed test date) always classifies it DUE.
  function outstandingFee(overrides: Partial<StudentFee> = {}): StudentFee {
    return studentFeeFactory({
      id: 'fee-1',
      month: 1,
      year: 2020,
      total_amount: 500,
      paid_amount: 0,
      discount_amount: 0,
      status: 'PENDING',
      ...overrides,
    });
  }

  // The default school-settings fixture's region (`schools.ts`'s
  // `DEFAULT_REGION`) uses Bengali numerals and zero decimal places —
  // realistic for the product's actual default, but it makes every money
  // assertion below have to spell out Bengali digits. Overriding to
  // Latin digits/2 decimals keeps this file's assertions readable; the
  // numeral-system behaviour itself is `currency.spec.ts`'s job to cover,
  // not this wizard's.
  function mockEnglishRegion() {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: {
            locale: 'en-BD',
            currency: {
              code: 'BDT',
              symbol: '৳',
              position: 'prefix',
              decimals: 2,
              grouping: 'lakh-crore',
            },
            numerals: 'latin',
            date: { format: 'DD/MM/YYYY', firstDayOfWeek: 0, calendar: 'gregorian' },
            phone: {
              country: 'BD',
              pattern: '^01[3-9]\\d{8}$',
              example: '01712345678',
              displayFormat: '01XXX-XXXXXX',
            },
            address: {
              fields: ['village', 'upazila', 'district'],
              order: ['village', 'upazila', 'district'],
            },
            academicYear: { startMonth: 1 },
            identifiers: { national: 'NID-##########', student: 'STU-####' },
            timezone: 'Asia/Dhaka',
          },
        }),
      ),
    );
  }

  function mockStudent() {
    server.use(
      http.get('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(studentFactory({ id: params.id as string, full_name: 'Karim Rahman' })),
      ),
    );
  }

  function mockFeeSummary(fees: StudentFee[]) {
    server.use(
      http.get('/api/v1/payments/invoices/student/:studentId', ({ params }) => {
        const totalDue = fees.reduce((sum, fee) => sum + fee.total_amount, 0);
        const totalPaid = fees.reduce((sum, fee) => sum + fee.paid_amount, 0);
        return HttpResponse.json({
          student_id: params.studentId,
          student_name: 'Karim Rahman',
          summary: {
            total_due: totalDue,
            total_paid: totalPaid,
            total_discount: 0,
            balance: totalDue - totalPaid,
          },
          fee_breakdown: fees,
          payments: [],
        });
      }),
    );
  }

  it('[8.10.5] records a full payment, generates an invoice, and shows a printable receipt', async () => {
    mockEnglishRegion();
    mockStudent();
    mockFeeSummary([outstandingFee()]);

    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/payments/record-with-allocation', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        // Same reasoning `payments.test.tsx`'s own non-optimistic-mutation
        // reference test gives for its `delay(30)`: without it, the mock
        // resolves inside the same tick the click happens in, and the
        // in-flight `disabled` state is never actually observable.
        await delay(30);
        const invoice = invoiceFactory({
          id: 'invoice-1',
          invoice_number: 'INV-0001',
          student_id: 'student-1',
          student_fee_id: 'fee-1',
          total_amount: 500,
        });
        const basePayment = paymentFactory({
          student_id: 'student-1',
          total_amount: 500,
          payment_method: 'CASH',
          invoice,
          invoice_id: invoice.id,
        });
        const payment: Payment = {
          ...basePayment,
          allocations: [
            {
              id: 'alloc-1',
              payment: basePayment,
              payment_id: basePayment.id,
              student_fee: outstandingFee({ paid_amount: 500, status: 'PAID' }),
              student_fee_id: 'fee-1',
              allocated_amount: 500,
              allocation_type: 'DUE',
              notes: null,
              created_at: new Date().toISOString(),
            },
          ],
        };
        return HttpResponse.json(payment, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/payments/record?student_id=student-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    // Outstanding fees step.
    await screen.findByText('Outstanding balance');
    const amountInput = screen.getByLabelText('Amount received');
    await user.type(amountInput, '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Allocate step — FIFO-prefilled to cover the fee in full already.
    await screen.findByText(/Allocated ৳500.00 of ৳500.00/);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Method & Reference step — CASH and the "generate invoice" toggle
    // are both already the defaults, so this step needs no input.
    await screen.findByLabelText('Payment method');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Confirm step (the review step `irreversible: true` requires).
    await screen.findByText(/Recording a payment of ৳500.00 for Karim Rahman/);
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Record payment' });

    // The assertion this whole ticket exists for: no success state on
    // screen while the request is in flight, and submit stays disabled
    // until the server actually responds.
    await user.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.queryByRole('status')).toBeNull();

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByText(/৳500.00 received from Karim Rahman/)).toBeTruthy();
    expect(screen.getByText(/Invoice INV-0001 generated/)).toBeTruthy();

    expect(capturedBody).toMatchObject({
      student_id: 'student-1',
      total_amount: 500,
      payment_method: 'CASH',
      generate_invoice: true,
      allocations: [{ student_fee_id: 'fee-1', allocated_amount: 500, allocation_type: 'DUE' }],
    });
  });

  it('[8.10.5] blocks over-allocation with an inline explanation', async () => {
    mockEnglishRegion();
    mockStudent();
    mockFeeSummary([outstandingFee()]);

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/payments/record?student_id=student-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText('Outstanding balance');
    await user.type(screen.getByLabelText('Amount received'), '300');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // FIFO prefilled 300 of the 500 owed — editing the line up to the
    // full 500 (still within the fee's own remaining balance, so the
    // clamp in `allocation-math.ts` allows it) now allocates more than
    // was received.
    const lineInput = await screen.findByLabelText('Amount allocated to 1/2020');
    await user.clear(lineInput);
    await user.type(lineInput, '500');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'The allocated amount is ৳200.00 more than the amount received',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
  });

  it('[8.10.5] preserves every entered value after a failed submission — nothing gets retyped', async () => {
    mockEnglishRegion();
    mockStudent();
    mockFeeSummary([outstandingFee()]);
    server.use(
      http.post('/api/v1/payments/record-with-allocation', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message:
              'FIFO violation: fee for 1/2020 was allocated before an earlier fee was settled',
            timestamp: new Date().toISOString(),
            path: '/api/v1/payments/record-with-allocation',
            requestId: crypto.randomUUID(),
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/payments/record?student_id=student-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText('Outstanding balance');
    await user.type(screen.getByLabelText('Amount received'), '500');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(/Allocated ৳500.00 of ৳500.00/);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('Transaction reference');
    await user.type(screen.getByLabelText('Transaction reference'), 'REF-42');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(/Recording a payment of ৳500.00/);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('FIFO violation'));
    expect(screen.queryByRole('status')).toBeNull();

    // Back to Method & Reference — the reference typed earlier is still
    // there, and the allocation total is still what it was.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText<HTMLInputElement>('Transaction reference').value).toBe('REF-42');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText<HTMLInputElement>('Amount allocated to 1/2020').value).toBe(
      '৳500.00',
    );
  });
});
