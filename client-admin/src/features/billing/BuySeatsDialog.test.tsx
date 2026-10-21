import '@biddaloy/ui/test';

import { ApiError } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summaryFree } from './billing-fixtures';
import { BuySeatsDialog } from './BuySeatsDialog';
import { payClosedOrder } from './BuySeatsFlow';

function setup(props: Partial<React.ComponentProps<typeof BuySeatsDialog>> = {}) {
  const onSubmit = vi.fn();
  renderWithProviders(
    <BuySeatsDialog
      open
      onOpenChange={() => undefined}
      initialSeats={300}
      onSubmit={onSubmit}
      {...props}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return onSubmit;
}

afterEach(async () => {
  await cleanupTestState();
});

describe('BuySeatsDialog', () => {
  it('prefills the seats and shows the live total', async () => {
    setup();
    const seats = await screen.findByLabelText<HTMLInputElement>('Seats (students)');
    expect(seats.value).toBe('300');
    // 300 seats x 1 month x BDT 10
    expect(screen.getByText(/Total:/).textContent).toContain('৩,০০০');
    const months = screen.getByLabelText('Months');
    await userEvent.clear(months);
    await userEvent.type(months, '3');
    expect(screen.getByText(/Total:/).textContent).toContain('৯,০০০');
  });

  it('refuses out-of-range input and sends nothing', async () => {
    const onSubmit = setup();
    const months = await screen.findByLabelText('Months');
    await userEvent.clear(months);
    await userEvent.type(months, '25');
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('reuses the same idempotency key when the admin retries', async () => {
    const onSubmit = setup({ failed: true });
    const submit = await screen.findByRole('button', { name: 'Create order' });
    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    const [a, b] = onSubmit.mock.calls.map((c) => c[0]);
    expect(a).toMatchObject({ seats: 300, months: 1 });
    expect(a.idempotency_key).toBe(b.idempotency_key);
    expect(a.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('after the order is created, Pay with bKash hands the order id to onPay', async () => {
    const onPay = vi.fn();
    setup({ created: summaryFree.orders[0]!, onPay });
    await userEvent.click(await screen.findByRole('button', { name: 'Pay with bKash' }));
    expect(onPay).toHaveBeenCalledWith(summaryFree.orders[0]!.id);
  });

  it('shows a plain error when the payment could not start', async () => {
    setup({ created: summaryFree.orders[0]!, onPay: vi.fn(), payFailed: true });
    expect(await screen.findByText(/could not start the payment/)).toBeTruthy();
  });

  it('keeps the key on a pay failure that leaves the order open, rotates it once the order is closed', async () => {
    const onSubmit = vi.fn();
    const props = { open: true, onOpenChange: () => undefined, initialSeats: 300, onSubmit };
    const { rerender } = renderWithProviders(<BuySeatsDialog {...props} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });
    const submit = await screen.findByRole('button', { name: 'Create order' });
    await userEvent.click(submit);
    // "Payment already starting" (409 PAYMENT_STARTING) or a 503: the same order must come back.
    rerender(<BuySeatsDialog {...props} payFailed />);
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    // The order is no longer PENDING (404 / 409 ORDER_NOT_PENDING): a new key, a new order.
    rerender(<BuySeatsDialog {...props} payFailed payClosed />);
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    const [a, b, c] = onSubmit.mock.calls.map((x) => x[0].idempotency_key);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe('payClosedOrder', () => {
  const err = (statusCode: number, code?: string) =>
    new ApiError({
      statusCode,
      message: 'x',
      requestId: 'r',
      path: '/p',
      timestamp: 't',
      ...(code ? { details: { code } } : {}),
    });

  it('only a 404 or a 409 ORDER_NOT_PENDING closes the order', () => {
    expect(payClosedOrder(err(404))).toBe(true);
    expect(payClosedOrder(err(409, 'ORDER_NOT_PENDING'))).toBe(true);
    expect(payClosedOrder(err(409, 'PAYMENT_STARTING'))).toBe(false);
    expect(payClosedOrder(err(409))).toBe(false);
    expect(payClosedOrder(err(503))).toBe(false);
    expect(payClosedOrder(new Error('network'))).toBe(false);
  });
});
