import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { LeaveDialog } from './leave-dialog';
import { ReadmitDialog } from './readmit-dialog';

const feeSummary = (balance: number) =>
  http.get('/api/v1/payments/invoices/student/:id', () =>
    HttpResponse.json({
      student_id: 's1',
      student_name: 'Karim Rahman',
      summary: { total_due: balance, total_paid: 0, total_discount: 0, balance },
      fee_breakdown: [],
      payments: [],
    }),
  );

const meta: Meta<typeof LeaveDialog> = {
  title: 'Students/Lifecycle dialogs',
  component: LeaveDialog,
  args: { open: true, onOpenChange: () => {}, studentId: 's1', studentName: 'Karim Rahman' },
  parameters: { msw: { handlers: [feeSummary(0)] } },
};

export default meta;
type Story = StoryObj<typeof LeaveDialog>;

export const Leave: Story = {};

/** Unpaid dues warn (D15) but never block submit. */
export const LeaveWithDuesWarning: Story = {
  parameters: { msw: { handlers: [feeSummary(1500)] } },
};

export const Readmit: StoryObj<typeof ReadmitDialog> = {
  render: (args) => <ReadmitDialog {...args} />,
  args: { open: true, onOpenChange: () => {}, studentId: 's1', studentName: 'Karim Rahman' },
};
