import type { Meta, StoryObj } from '@storybook/react-vite';

import { RecordPaymentDialog } from './record-payment-dialog';

/** Epic 49 W4. Opens the dialog; nobody submits from a story, so no request is made. */
const meta: Meta<typeof RecordPaymentDialog> = {
  component: RecordPaymentDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
    order: { id: '00000000-0000-4000-8000-0000000000a1', seats: 40, months: 3 },
  },
};
export default meta;

type Story = StoryObj<typeof RecordPaymentDialog>;

export const Default: Story = {};

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
