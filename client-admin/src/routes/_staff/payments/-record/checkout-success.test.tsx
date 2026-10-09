import type { CheckoutResult } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CheckoutSuccess } from './checkout-success';

const RESULT: CheckoutResult = {
  payment: {
    id: 'payment-1',
    student: { id: 'student-1', full_name: 'Rahim Ahmed' },
    total_amount: 5000,
  } as CheckoutResult['payment'],
  invoice_id: 'invoice-1',
  invoice_number: 'INV-2026-000123',
  change_amount: 0,
  wallet_balance_after: 0,
};

describe('CheckoutSuccess', () => {
  beforeEach(() => {
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json({ guardians: [] })));
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows amount paid and invoice number', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-1']} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('INV-2026-000123')).toBeTruthy();
  });

  it('shows change due prominently when change_amount > 0', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={{ ...RESULT, change_amount: 500 }} studentIds={['student-1']} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('Change due')).toBeTruthy();
  });

  it('does not show change due when change_amount is 0', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-1']} />,
      { locale: 'en' },
    );
    await localeReady;
    await screen.findByText('INV-2026-000123');
    expect(screen.queryByText('Change due')).toBeNull();
  });

  it('has no inline action row (record another / view invoice live in the page footer)', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-1']} />,
      { locale: 'en' },
    );
    await localeReady;
    await screen.findByText('INV-2026-000123');
    expect(screen.queryByRole('button', { name: 'Record another' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View invoice' })).toBeNull();
  });

  it('labels the paper-size choice from the payments namespace', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-1']} />,
      { locale: 'en', role: 'ACCOUNTANT', tenantId: 'tenant-1' },
    );
    await localeReady;
    const group = await screen.findByRole('radiogroup', { name: 'Paper size' });
    expect(within(group).getByRole('radio', { name: 'A4 page' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'Receipt printer — 80 mm' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'Receipt printer — 58 mm' })).toBeTruthy();
  });

  it('sends immediately when there is exactly one send candidate', async () => {
    server.use(
      http.get('/api/v1/students/:id', () =>
        HttpResponse.json({
          guardians: [
            {
              id: 'guardian-1',
              full_name: 'Fatima Begum',
              is_primary_contact: true,
              notifications_enabled: true,
            },
          ],
        }),
      ),
      http.post('/api/v1/invoices/:id/send', () => new HttpResponse(null, { status: 201 })),
    );

    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-with-one-guardian']} />,
      { locale: 'en', role: 'ACCOUNTANT', tenantId: 'tenant-1' },
    );
    await localeReady;

    const sendButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Send via WhatsApp',
    });
    await waitFor(() => expect(sendButton.disabled).toBe(false));
    await user.click(sendButton);
    expect(screen.queryByText('Choose a guardian')).toBeNull();
  });

  it('opens a guardian picker when there is more than one send candidate', async () => {
    server.use(
      http.get('/api/v1/students/:id', () =>
        HttpResponse.json({
          guardians: [
            {
              id: 'guardian-1',
              full_name: 'Fatima Begum',
              is_primary_contact: true,
              notifications_enabled: true,
            },
            {
              id: 'guardian-2',
              full_name: 'Karim Uddin',
              is_primary_contact: true,
              notifications_enabled: true,
            },
          ],
        }),
      ),
      http.post('/api/v1/invoices/:id/send', () => new HttpResponse(null, { status: 201 })),
    );

    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} studentIds={['student-with-two-guardians']} />,
      { locale: 'en', role: 'ACCOUNTANT', tenantId: 'tenant-1' },
    );
    await localeReady;

    const sendButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Send via WhatsApp',
    });
    await waitFor(() => expect(sendButton.disabled).toBe(false));
    await user.click(sendButton);
    expect(await screen.findByText('Choose a guardian')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Karim Uddin' }));
    await waitFor(() => expect(screen.queryByText('Choose a guardian')).toBeNull());
  });
});
