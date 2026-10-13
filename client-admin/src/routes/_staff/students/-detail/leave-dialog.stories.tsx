import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within } from 'storybook/test';

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

/** Backdated leave: the dialog stays open on the bills-after-leave result step. */
export const LeaveResultWithBills: Story = {
  parameters: {
    msw: {
      handlers: [
        feeSummary(0),
        http.post('/api/v1/students/s1/leave', () =>
          HttpResponse.json(
            {
              id: 'e1',
              bills_due_after_leave: [
                {
                  id: 'b1',
                  fee_structure_name: 'Monthly tuition',
                  period_start: '2026-09-01',
                  due_date: '2026-09-10',
                  outstanding: '700.00',
                },
              ],
            },
            { status: 201 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByLabelText('Reason'), 'Moved away');
    await userEvent.click(body.getByRole('button', { name: 'Record leaving' }));
    await expect(await body.findByText('Bills after the leave date')).toBeVisible();
  },
};

export const Readmit: StoryObj<typeof ReadmitDialog> = {
  render: (args) => <ReadmitDialog {...args} />,
  args: { open: true, onOpenChange: () => {}, studentId: 's1', studentName: 'Karim Rahman' },
};
