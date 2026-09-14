import { PaymentMethod } from '@biddaloy/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../i18n';
import { paymentFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { renderWithProviders } from '../test/render-with-providers';

import {
  cartKeys,
  useCart,
  useCheckout,
  usePaymentsByGuardian,
  usePaymentsByStudent,
  useStudentFeeSummary,
} from './payments';

function cartResponse() {
  return {
    students: [
      {
        id: 'student-1',
        full_name: 'Rahim Uddin',
        registration_number: 'R-1',
        class_name: 'Six',
        section_name: 'A',
        wallet_balance: 0,
        bills: [],
      },
    ],
    total_balance: 0,
    suggested: { allocations: [], wallet_used: 0, remaining: 0, to_wallet: 0 },
  };
}

describe('cartKeys', () => {
  it('is order-independent for the same set of student ids', () => {
    expect(cartKeys.query(['a', 'b'], 100)).toEqual(cartKeys.query(['b', 'a'], 100));
  });
});

describe('useCart', () => {
  it('[16.4.4] stays disabled and issues no request with an empty selection', () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/payments/cart', () => {
        requestCount += 1;
        return HttpResponse.json(cartResponse());
      }),
    );

    const { result } = renderHookWithProviders(
      () => useCart({ studentIds: [], config: REGION_BD_EN }),
      { tenantId: 'tenant-1' },
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestCount).toBe(0);
  });

  it('requests /payments/cart with the sorted student ids and optional amount', async () => {
    let receivedUrl: URL | undefined;
    server.use(
      http.get('/api/v1/payments/cart', ({ request }) => {
        receivedUrl = new URL(request.url);
        return HttpResponse.json(cartResponse());
      }),
    );

    const { result } = renderHookWithProviders(
      () => useCart({ studentIds: ['b', 'a'], amount: 5000, config: REGION_BD_EN }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(receivedUrl?.searchParams.get('student_ids')).toBe('a,b');
    // F1: `amount` (minor units in) travels as major-unit decimal on the
    // wire — matching every other amount field on the same response.
    expect(receivedUrl?.searchParams.get('amount')).toBe('50.00');
  });
});

describe('useCheckout', () => {
  it('[16.4.4] posts to /payments/checkout and resolves the checkout result', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/payments/checkout', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            payment: paymentFactory(),
            invoice_id: 'invoice-1',
            invoice_number: 'INV-1',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        );
      }),
    );

    const input = {
      idempotency_key: 'key-1',
      lines: [{ student_fee_id: 'fee-1', amount: 5000, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
    };

    function Harness() {
      const checkout = useCheckout();
      return (
        <div>
          <button onClick={() => checkout.mutate(input)}>run</button>
          {checkout.isSuccess && <span data-testid="result">{checkout.data.invoice_number}</span>}
          {checkout.modal}
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en' });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByText('INV-1', { selector: '[data-testid="result"]' });
    expect(body).toEqual(input);
  });

  it('invalidates cart, payments, dues and invoice keys on success', async () => {
    let cartRequestCount = 0;
    server.use(
      http.get('/api/v1/payments/cart', () => {
        cartRequestCount += 1;
        return HttpResponse.json(cartResponse());
      }),
      http.post('/api/v1/payments/checkout', () =>
        HttpResponse.json(
          {
            payment: paymentFactory(),
            invoice_id: 'invoice-1',
            invoice_number: 'INV-1',
            change_amount: 0,
            wallet_balance_after: 0,
          },
          { status: 201 },
        ),
      ),
    );

    const input = {
      idempotency_key: 'key-1',
      lines: [{ student_fee_id: 'fee-1', amount: 5000, one_off_discount: 0 }],
      payment_method: PaymentMethod.CASH,
    };

    const { result } = renderHookWithProviders(
      () => ({
        cart: useCart({ studentIds: ['student-1'], config: REGION_BD_EN }),
        checkout: useCheckout(),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.cart.isSuccess).toBe(true));
    expect(cartRequestCount).toBe(1);

    result.current.checkout.mutate(input);

    await waitFor(() => expect(result.current.checkout.isSuccess).toBe(true));
    // Cart re-fetched because `cartKeys.all` was invalidated.
    await waitFor(() => expect(cartRequestCount).toBe(2));
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

describe('usePaymentsByGuardian', () => {
  it("[8.11.4] resolves the payment history for a guardian's linked students", async () => {
    server.use(
      http.get('/api/v1/payments/guardian/:guardianId', () =>
        HttpResponse.json([paymentFactory(), paymentFactory()]),
      ),
    );

    const { result } = renderHookWithProviders(() => usePaymentsByGuardian('guardian-1'), {
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
