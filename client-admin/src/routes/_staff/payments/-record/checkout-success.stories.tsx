import type { CheckoutResult } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { CheckoutSuccess } from './checkout-success';

/**
 * [16.5.5]'s real success view — same Storybook-not-wired-for-`client-admin`
 * gap `record-payment-modal.stories.tsx` documents (`ui/.storybook/main.ts:25`
 * only globs `ui/src/**`), so this file is written anyway, ready once that
 * wiring gap closes.
 */
const meta: Meta<typeof CheckoutSuccess> = {
  component: CheckoutSuccess,
  args: {
    onRecordAnother: () => undefined,
    onViewInvoice: () => undefined,
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/students/:id', () => HttpResponse.json({ guardians: [] }))],
    },
  },
};

export default meta;
type Story = StoryObj<typeof CheckoutSuccess>;

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

export const ExactAmount: Story = {
  args: { result: RESULT },
};

export const WithChange: Story = {
  args: { result: { ...RESULT, change_amount: 500 } },
};
