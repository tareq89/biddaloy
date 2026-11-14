import '@biddaloy/ui/test';

import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuySmsBundleDialog, BuySmsBundleFlow } from './BuySmsBundleDialog';

const PACKAGES = [
  ['Small', 500, '50000'],
  ['Medium', 2000, '180000'],
].map(([name, smsCount, pricePaisa], i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`,
  name: String(name),
  smsCount: Number(smsCount),
  validityDays: 90,
  pricePaisa: String(pricePaisa),
  priceTaka: '0',
  active: true,
}));

const assign = vi.fn();
beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupTestState();
});

function setup() {
  renderWithProviders(
    <BuySmsBundleFlow
      open
      onOpenChange={() => undefined}
      packages={PACKAGES}
      selected={PACKAGES[1]!}
      onSelect={() => undefined}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
}

const err = (status: number, details?: Record<string, string>) =>
  HttpResponse.json(
    {
      ...apiErrorBody(status, 'x', '/api/v1/sms-bundles/orders'),
      ...(details ? { details } : {}),
    },
    { status },
  );

describe('BuySmsBundleFlow', () => {
  it('creates the order, pays, and goes to bKash', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://bkash.example.test/checkout/demo'),
    );
  });

  it('sends the same Idempotency-Key on a retry after a failure', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/sms-bundles/orders', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return err(500);
      }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Buy with bKash' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('says plainly when SMS cannot be sold now, without numbers', async () => {
    server.use(
      http.post('/api/v1/sms-bundles/orders', () => err(409, { code: 'SMS_SALES_PAUSED' })),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('We cannot sell SMS right now. Please try again later.');
  });

  it('returns to the form when the server closed the order', async () => {
    server.use(
      http.post('/api/v1/sms-bundles/orders/:id/pay/bkash', () =>
        err(409, { code: 'ORDER_NOT_PENDING' }),
      ),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
    expect(await screen.findByRole('button', { name: 'Buy with bKash' })).toBeTruthy();
    expect(screen.queryByText('Order ready')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps Pay available when starting the payment fails', async () => {
    server.use(http.post('/api/v1/sms-bundles/orders/:id/pay/bkash', () => err(503)));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy with bKash' }));
    expect(await screen.findByRole('button', { name: 'Pay with bKash' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the created order snapshot, not the current catalog selection', async () => {
    renderWithProviders(
      <BuySmsBundleDialog
        open
        onOpenChange={() => undefined}
        packages={PACKAGES}
        selected={PACKAGES[1]!}
        onSelect={() => undefined}
        onSubmit={() => undefined}
        created={{
          id: 'o1',
          packageId: PACKAGES[0]!.id,
          name: 'Small',
          smsCount: 500,
          validityDays: 90,
          pricePaisa: '50000',
          costPaisaPerSms: null,
          status: 'PENDING_PAYMENT',
          createdAt: '2026-11-14T00:00:00Z',
          paidAt: null,
          cancelledAt: null,
        }}
        onPay={() => undefined}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
    );
    const body = (await screen.findByText(/Pay with bKash to add them/)).textContent ?? '';
    expect(body).toMatch(/^500 SMS|^৫০০ SMS/);
    expect(body).not.toMatch(/2,000|২,০০০/);
  });
});
