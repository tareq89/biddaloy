import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletPayoutDialog } from './wallet-payout-dialog';

async function renderDialog() {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <WalletPayoutDialog open onOpenChange={onOpenChange} studentId="student-1" balance="150.00" />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { onOpenChange };
}

describe('WalletPayoutDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prefills the full balance, warns about cash, and needs a reason', async () => {
    const user = userEvent.setup();
    await renderDialog();

    expect(await screen.findByText(/Credit balance: ৳/)).toBeTruthy();
    expect(screen.getByText(/records cash handed back/)).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount to pay out' }).value,
    ).toContain('১৫০');
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Pay out' });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Left school');
    expect(confirm.disabled).toBe(false);
  });

  it('blocks an amount above the balance', async () => {
    const user = userEvent.setup();
    await renderDialog();

    const amount = screen.getByRole('textbox', { name: 'Amount to pay out' });
    await user.clear(amount);
    await user.type(amount, '200');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Left school');

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pay out' }).disabled).toBe(true);
  });

  it('posts amount and reason, then closes', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/students/student-1/wallet/payout', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ balance: 0, transactions: [] });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Left school');
    await user.click(screen.getByRole('button', { name: 'Pay out' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ amount: 150, reason: 'Left school' });
  });

  it("on 409 shows the server's balance", async () => {
    server.use(
      http.post('/api/v1/students/student-1/wallet/payout', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Payout must be more than 0 and no more than the wallet balance',
            timestamp: new Date().toISOString(),
            path: '/students/student-1/wallet/payout',
            requestId: 'req-1',
            details: { balance: 20 },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Left school');
    await user.click(screen.getByRole('button', { name: 'Pay out' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/The balance is now ৳/);
  });
});
