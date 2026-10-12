import type { StudentFee } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { userEvent, within } from 'storybook/test';

import { WalletPayoutDialog } from './wallet-payout-dialog';
import { WriteOffBillDialog } from './write-off-bill-dialog';

const bill = {
  id: 'bill-1',
  fee_structure: { id: 's1', name: 'Tuition' },
  period_start: '2026-03-01T00:00:00.000Z',
  total_amount: '1000.00',
  paid_amount: '400.00',
  discount_amount: '0.00',
} as unknown as StudentFee;

const meta: Meta<typeof WriteOffBillDialog> = {
  title: 'Students/Fee correction dialogs',
  component: WriteOffBillDialog,
  args: { open: true, onOpenChange: () => {}, bill },
};

export default meta;

/** Full write-off is the default choice. */
export const WriteOffFull: StoryObj<typeof WriteOffBillDialog> = {};

export const WriteOffPartial: StoryObj<typeof WriteOffBillDialog> = {
  play: async () => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole('radio', { name: /part of it|কিছু টাকা/ }));
  },
};

/** The bill was settled elsewhere: the server answers 409. */
export const WriteOffConflict: StoryObj<typeof WriteOffBillDialog> = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/fees/bills/:id/waive', () =>
          HttpResponse.json({ statusCode: 409, message: 'Already settled' }, { status: 409 }),
        ),
      ],
    },
  },
  play: async () => {
    const body = within(document.body);
    await userEvent.type(await body.findByRole('textbox', { name: /Reason|কারণ/ }), 'Hardship');
    await userEvent.click(body.getByRole('button', { name: /^(Write off|মওকুফ করুন)$/ }));
  },
};

/** Balance prefilled, with the cash-handed-back warning. */
export const WalletPayout: StoryObj<typeof WalletPayoutDialog> = {
  render: (args) => <WalletPayoutDialog {...args} />,
  args: { open: true, onOpenChange: () => {}, studentId: 's1', balance: '150.00' },
};

export const WalletPayoutExceedsBalance: StoryObj<typeof WalletPayoutDialog> = {
  ...WalletPayout,
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/students/:id/wallet/payout', () =>
          HttpResponse.json(
            { statusCode: 409, message: 'Exceeds balance', details: { balance: 20 } },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async () => {
    const body = within(document.body);
    await userEvent.type(await body.findByRole('textbox', { name: /Reason|কারণ/ }), 'Left school');
    await userEvent.click(body.getByRole('button', { name: /^(Pay out|ফেরত দিন)$/ }));
  },
};
