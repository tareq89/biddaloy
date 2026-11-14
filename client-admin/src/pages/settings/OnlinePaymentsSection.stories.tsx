import type { Meta, StoryObj } from '@storybook/react-vite';

import { OnlinePaymentsSection } from './OnlinePaymentsSection';

/** Online payments settings card, proof half (#3977). */
const meta: Meta<typeof OnlinePaymentsSection> = {
  component: OnlinePaymentsSection,
  args: { schoolId: 'school-1' },
};
export default meta;

type Story = StoryObj<typeof OnlinePaymentsSection>;

export const Off: Story = { args: { payments: undefined } };
export const On: Story = {
  args: {
    payments: {
      proofEnabled: true,
      proofMethods: [
        { method: 'BKASH', instructions: 'Send Money to 01711-000000.' },
        { method: 'BANK_TRANSFER', instructions: 'Sample Bank, account 123456.' },
      ],
    },
  },
};
