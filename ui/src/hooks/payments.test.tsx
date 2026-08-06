import { fireEvent, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { paymentFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { createTestQueryClient, renderWithProviders } from '../test/render-with-providers';

import { useCreatePayment } from './payments';

/**
 * [8.4.4]'s AC calls for a submit control and preserved form state, which
 * needs an actual rendered form — not just a hook-level assertion. No real
 * `Input`/form primitive exists in `@beton-boi/ui/components` yet (only
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
