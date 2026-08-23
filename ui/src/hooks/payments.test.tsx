import { fireEvent, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { paymentFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient, renderWithProviders } from '../test/render-with-providers';

import {
  useCreatePayment,
  usePaymentsByStudent,
  useRecordPaymentWithAllocation,
  useStudentFeeSummary,
} from './payments';

/**
 * [8.4.4]'s AC calls for a submit control and preserved form state, which
 * needs an actual rendered form — not just a hook-level assertion. No real
 * `Input`/form primitive exists in `@biddaloy/ui/components` yet (only
 * `Button` — see `ui/src/primitives/README.md`; real shadcn wrappers are
 * epic 8.6's job), so this is a local, test-only reference component using
 * plain HTML form elements, the same way `render-hook-with-providers.test.
 * tsx`'s probe hooks are local stand-ins rather than real exports. It
 * exists only to prove the pattern `useCreatePayment` enables — a real
 * payment form will replace it once real form primitives exist.
 */
function PaymentForm({ studentId }: { studentId: string }) {
  const [amount, setAmount] = useState('');
  const mutation = useCreatePayment();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(
          { student_id: studentId, total_amount: Number(amount), payment_method: 'CASH' },
          { onSuccess: () => setAmount('') },
        );
      }}
    >
      <input
        aria-label="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <button type="submit" disabled={mutation.isPending}>
        Record payment
      </button>
      {mutation.isPending && <p>Recording…</p>}
      {mutation.isSuccess && <p>Payment recorded</p>}
      {mutation.isError && (
        <p role="alert">{mutation.error instanceof Error ? mutation.error.message : 'Error'}</p>
      )}
    </form>
  );
}

describe('financial mutations are never optimistic (useCreatePayment reference)', () => {
  it('shows no success state and disables submit while the request is in flight', async () => {
    server.use(
      http.post('/api/v1/payments', async () => {
        await delay(30);
        return HttpResponse.json(paymentFactory(), { status: 201 });
      }),
    );

    const { user } = renderWithProviders(<PaymentForm studentId="student-1" />, {
      tenantId: 'tenant-1',
    });

    await user.type(screen.getByLabelText('Amount'), '4500');
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Record payment' });
    fireEvent.click(submit);

    // The assertion this whole ticket exists for: while the request is
    // in flight, there is no success state on screen — an optimistic
    // mutation would show "Payment recorded" here, before the server has
    // said anything at all.
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.queryByText('Payment recorded')).toBeNull();

    await waitFor(() => expect(screen.getByText('Payment recorded')).toBeTruthy());
    expect(submit.disabled).toBe(false);
  });

  it('preserves the entered amount on failure — nothing gets retyped', async () => {
    server.use(
      http.post('/api/v1/payments', () =>
        HttpResponse.json(apiErrorBody(500, 'Payment gateway unavailable', '/api/v1/payments'), {
          status: 500,
        }),
      ),
    );

    // `useCreatePayment`'s own `retry: shouldRetryQuery` overrides
    // `createTestQueryClient()`'s client-level `mutations.retry: false` —
    // a 500 is retryable, so `retryDelay: 0` keeps this test from waiting
    // out real exponential backoff (same interaction as students.test.tsx).
    const queryClient = createTestQueryClient();
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      mutations: { retryDelay: 0 },
    });

    const { user } = renderWithProviders(<PaymentForm studentId="student-1" />, {
      tenantId: 'tenant-1',
      queryClient,
    });

    const amountInput = screen.getByLabelText<HTMLInputElement>('Amount');
    await user.type(amountInput, '4500');
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Record payment' });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Payment gateway unavailable'),
    );
    expect(screen.queryByText('Payment recorded')).toBeNull();
    // The value the accountant typed is still there — they don't have to
    // retype "4500" after a failure.
    expect(amountInput.value).toBe('4500');
    expect(submit.disabled).toBe(false);
  });
});

describe('usePaymentsByStudent', () => {
  it('[8.10.2] resolves the payment history for one student', async () => {
    server.use(
      http.get('/api/v1/payments/student/:studentId', () =>
        HttpResponse.json([paymentFactory(), paymentFactory()]),
      ),
    );

    const { result } = renderHookWithProviders(() => usePaymentsByStudent('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });
});

describe('useStudentFeeSummary', () => {
  it("[8.10.2] resolves the Fees tab's billed/paid/outstanding summary", async () => {
    server.use(
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          summary: { total_due: 5000, total_paid: 3000, total_discount: 0, balance: 2000 },
          fee_breakdown: [],
          payments: [],
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useStudentFeeSummary('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary.balance).toBe(2000);
  });

  it('[8.10.5] stays disabled and issues no request when studentId is undefined', () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/payments/invoices/student/:studentId', () => {
        requestCount += 1;
        return HttpResponse.json({
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          summary: { total_due: 0, total_paid: 0, total_discount: 0, balance: 0 },
          fee_breakdown: [],
          payments: [],
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useStudentFeeSummary(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestCount).toBe(0);
  });
});

describe('useRecordPaymentWithAllocation', () => {
  it('[8.10.5] posts to record-with-allocation and returns the recorded payment', async () => {
    server.use(
      http.post('/api/v1/payments/record-with-allocation', async ({ request }) => {
        const body = (await request.json()) as { student_id: string; total_amount: number };
        return HttpResponse.json(
          paymentFactory({ student_id: body.student_id, total_amount: body.total_amount }),
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useRecordPaymentWithAllocation(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({
      student_id: 'student-1',
      total_amount: 4500,
      payment_method: 'CASH',
      allocations: [{ student_fee_id: 'fee-1', allocated_amount: 4500, allocation_type: 'DUE' }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.student_id).toBe('student-1');
    expect(result.current.data?.total_amount).toBe(4500);
  });

  it("[8.10.5] invalidates the student's fee summary on success — a re-opened Fees tab shows the new balance, not a stale one", async () => {
    const queryClient = createTestQueryClient();
    server.use(
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          summary: { total_due: 5000, total_paid: 0, total_discount: 0, balance: 5000 },
          fee_breakdown: [],
          payments: [],
        }),
      ),
      http.post('/api/v1/payments/record-with-allocation', () =>
        HttpResponse.json(paymentFactory({ student_id: 'student-1' }), { status: 201 }),
      ),
    );

    // A live `useStudentFeeSummary` observer, same reasoning as
    // `students.test.tsx`'s `useUpdateStudentEnrollmentStatus` test —
    // `invalidateQueries` only triggers a background refetch for a query
    // someone is actually watching.
    const { result } = renderHookWithProviders(
      () => ({
        summary: useStudentFeeSummary('student-1'),
        record: useRecordPaymentWithAllocation(),
      }),
      { tenantId: 'tenant-1', queryClient },
    );

    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    expect(result.current.summary.data?.summary.balance).toBe(5000);

    server.use(
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          summary: { total_due: 5000, total_paid: 4500, total_discount: 0, balance: 500 },
          fee_breakdown: [],
          payments: [],
        }),
      ),
    );

    result.current.record.mutate({
      student_id: 'student-1',
      total_amount: 4500,
      payment_method: 'CASH',
      allocations: [{ student_fee_id: 'fee-1', allocated_amount: 4500, allocation_type: 'DUE' }],
    });

    await waitFor(() => expect(result.current.record.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.summary.data?.summary.balance).toBe(500));
  });

  it('preserves the mutation input on failure — nothing the accountant typed needs retyping', async () => {
    server.use(
      http.post('/api/v1/payments/record-with-allocation', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            'Allocation amounts must sum to total_amount',
            '/api/v1/payments/record-with-allocation',
          ),
          { status: 400 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useRecordPaymentWithAllocation(), {
      tenantId: 'tenant-1',
    });

    const input = {
      student_id: 'student-1',
      total_amount: 4500,
      payment_method: 'CASH' as const,
      allocations: [
        { student_fee_id: 'fee-1', allocated_amount: 100, allocation_type: 'DUE' as const },
      ],
    };
    result.current.mutate(input);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    // React Query keeps the last `variables` around on failure — a caller
    // reads this instead of holding its own separate copy, so nothing
    // needs to be retyped after a failed submit.
    expect(result.current.variables).toEqual(input);
  });
});
