import type { CartStudent } from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CartTable, type CartLineState } from './cart-table';

function student(overrides: Partial<CartStudent> = {}): CartStudent {
  return {
    id: 'student-1',
    full_name: 'Rahim Uddin',
    registration_number: 'R-1',
    class_name: 'Six',
    section_name: 'A',
    wallet_balance: 0,
    bills: [
      {
        student_fee_id: 'fee-1',
        fee_name: 'Tuition — March',
        fee_type: 'TUITION',
        period_start: '2026-03-01',
        period_type: 'MONTH',
        occurrence: 1,
        total_amount: 5000,
        standing_discount_amount: 0,
        one_off_discount_amount: 0,
        paid_amount: 0,
        balance: 5000,
        due_date: '2026-03-10',
        is_late_fee: false,
        is_overdue: false,
        suggested_allocation: 5000,
      },
    ],
    ...overrides,
  };
}

async function renderTable(overrides: Partial<React.ComponentProps<typeof CartTable>> = {}) {
  const onLineChange = vi.fn();
  const onWalletUseChange = vi.fn();
  const view = renderWithProviders(
    <CartTable
      students={[student()]}
      lines={new Map<string, CartLineState>()}
      onLineChange={onLineChange}
      lineValidity={new Map<string, boolean>()}
      config={REGION_BD_EN}
      subtotalMinorUnits={0}
      walletBalanceMinorUnits={0}
      walletUseMinorUnits={0}
      onWalletUseChange={onWalletUseChange}
      amountDueMinorUnits={0}
      {...overrides}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { onLineChange, onWalletUseChange };
}

describe('CartTable', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('[16.4.4] renders overdue due dates and a late-fee marker', async () => {
    await renderTable({
      students: [
        student({
          bills: [
            {
              ...student().bills[0]!,
              is_overdue: true,
              is_late_fee: true,
            },
          ],
        }),
      ],
    });

    expect((await screen.findByText('2026-03-10')).className).toContain('text-destructive');
    expect(await screen.findByText('Late fee')).toBeTruthy();
    expect(await screen.findByText('Overdue')).toBeTruthy();
  });

  it('shows the empty-cart message when no bills are open', async () => {
    await renderTable({ students: [student({ bills: [] })] });

    expect(await screen.findByText('This student has no open bills.')).toBeTruthy();
  });

  it('caps the wallet credit toggle at the wallet balance and subtotal', async () => {
    const user = userEvent.setup();
    const { onWalletUseChange } = await renderTable({
      walletBalanceMinorUnits: 10000,
      subtotalMinorUnits: 5000,
    });

    await user.click(await screen.findByLabelText(/Use wallet credit/));
    expect(onWalletUseChange).toHaveBeenCalledWith(5000);
  });

  it('computes subtotal and amount-due arithmetic in minor units', async () => {
    await renderTable({ subtotalMinorUnits: 500000, amountDueMinorUnits: 450000 });

    expect((await screen.findAllByText('৳5,000.00')).length).toBeGreaterThan(0);
    expect(await screen.findByText('৳4,500.00')).toBeTruthy();
  });
});
