import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summaryFree } from './billing-fixtures';
import { BuySeatsDialog } from './BuySeatsDialog';

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
});
