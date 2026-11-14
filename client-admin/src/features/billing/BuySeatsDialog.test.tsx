import '@biddaloy/ui/test';

import { SeatOrderStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
      unitPricePaisa={1000}
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
    const props = {
      open: true,
      onOpenChange: () => undefined,
      initialSeats: 300,
      unitPricePaisa: 1000,
      onSubmit,
    };
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

describe('BuySeatsDialog coupon', () => {
  const paid = { ...summaryFree.orders[0]!, status: SeatOrderStatus.PAID, amount_paisa: 0 };

  async function applyCode(code: string) {
    await userEvent.click(await screen.findByRole('button', { name: 'Have a coupon?' }));
    await userEvent.type(screen.getByLabelText('Coupon code'), code);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  }

  it('prints the price from the prop, not a fixed Tk 10', async () => {
    setup({ unitPricePaisa: 2500 });
    expect((await screen.findByText(/per seat per month/)).textContent).toContain('২৫');
    // 300 seats x 1 month x Tk 25
    expect(screen.getByText(/Total:/).textContent).toContain('৭,৫০০');
  });

  it('a half-off code shows list, discount and the new total, and sends the upper-cased code', async () => {
    const onSubmit = setup({ initialSeats: 50 });
    const months = await screen.findByLabelText('Months');
    await userEvent.clear(months);
    await userEvent.type(months, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Have a coupon?' }));
    await userEvent.type(screen.getByLabelText('Coupon code'), 'half');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // msw preview prices at Tk 50: 50 x 3 x 50 = 7,500, half off.
    expect(await screen.findByText(/New total:/)).toBeTruthy();
    expect(screen.getByText(/New total:/).textContent).toContain('৩,৭৫০');
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ coupon_code: 'HALF', seats: 50, months: 3 });
  });

  it('sends no coupon_code when none was applied', async () => {
    const onSubmit = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Create order' }));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('coupon_code');
  });

  it('cannot submit while the coupon preview is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post('/api/v1/billing/orders/preview', async () => {
        await gate;
        return HttpResponse.json({
          listAmountPaisa: 1,
          discountPaisa: 0,
          totalPaisa: 1,
          free: false,
        });
      }),
    );
    const onSubmit = setup();
    await applyCode('HALF');
    const submit = await screen.findByRole('button', { name: 'Create order' });
    await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    await userEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps the idempotency key when only an unapplied code is typed', async () => {
    const onSubmit = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Create order' }));
    await userEvent.click(screen.getByRole('button', { name: 'Have a coupon?' }));
    await userEvent.type(screen.getByLabelText('Coupon code'), 'ZZ');
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    const [a, b] = onSubmit.mock.calls.map((x) => x[0].idempotency_key);
    expect(b).toBe(a);
  });

  it('a free result renames the button to "Get seats free"', async () => {
    setup();
    await applyCode('FREE');
    expect(await screen.findByRole('button', { name: 'Get seats free' })).toBeTruthy();
  });

  it('a rejected coupon on submit shows the sentence and takes a new key', async () => {
    const onSubmit = vi.fn();
    const props = {
      open: true,
      onOpenChange: () => undefined,
      initialSeats: 300,
      unitPricePaisa: 1000,
      onSubmit,
    };
    const { rerender } = renderWithProviders(<BuySeatsDialog {...props} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'school-1',
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Create order' }));
    rerender(<BuySeatsDialog {...props} couponRejected />);
    expect(await screen.findByText('This coupon cannot be used.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }));
    const [a, b] = onSubmit.mock.calls.map((x) => x[0].idempotency_key);
    expect(b).not.toBe(a);
  });

  it('a created order that is already paid shows done + receipt and no bKash step', async () => {
    const onReceipt = vi.fn();
    setup({ created: paid, onPay: vi.fn(), onReceipt });
    expect(await screen.findByText(/nothing to pay/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay with bKash' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download receipt' }));
    expect(onReceipt).toHaveBeenCalledWith(paid.id);
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
