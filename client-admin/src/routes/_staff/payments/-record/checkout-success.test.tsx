import type { CheckoutResult } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      <CheckoutSuccess result={RESULT} onRecordAnother={vi.fn()} onViewInvoice={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('INV-2026-000123')).toBeTruthy();
  });

  it('shows change due prominently when change_amount > 0', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess
        result={{ ...RESULT, change_amount: 500 }}
        onRecordAnother={vi.fn()}
        onViewInvoice={vi.fn()}
      />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('Change due')).toBeTruthy();
  });

  it('does not show change due when change_amount is 0', async () => {
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} onRecordAnother={vi.fn()} onViewInvoice={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;
    await screen.findByText('INV-2026-000123');
    expect(screen.queryByText('Change due')).toBeNull();
  });

  it('calls onRecordAnother when the button is clicked', async () => {
    const user = userEvent.setup();
    const onRecordAnother = vi.fn();
    const { localeReady } = renderWithProviders(
      <CheckoutSuccess result={RESULT} onRecordAnother={onRecordAnother} onViewInvoice={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Record another' }));
    expect(onRecordAnother).toHaveBeenCalledOnce();
  });
});
