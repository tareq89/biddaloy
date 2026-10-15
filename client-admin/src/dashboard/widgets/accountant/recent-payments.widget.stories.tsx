import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { RecentPaymentsView, type RecentPaymentsDto } from './recent-payments.widget';

const methods = ['CASH', 'BKASH', 'BANK_TRANSFER', 'CASH', 'CARD'] as const;
const item = (i: number, over: Partial<RecentPaymentsDto['items'][number]> = {}) => ({
  payment_id: `00000000-0000-4000-8000-00000000000${i}`,
  student_name: ['Rahim Uddin', 'Nusrat Jahan', 'Karim Hossain', 'Sadia Akter', 'Tanvir Ahmed'][i]!,
  class_name: 'Class 6',
  section_name: 'A',
  amount: 1500 + i * 500,
  payment_method: methods[i]!,
  payment_status: 'SUCCESS' as const,
  payment_date: '2026-10-07T04:06:00.000Z',
  ...over,
});

const data: RecentPaymentsDto = {
  total_of_shown: 1500 + 2000 + 2500 + 3000 + 3500,
  items: [0, 1, 2, 3, 4].map((i) => item(i)),
};

const meta: Meta<typeof RecentPaymentsView> = {
  title: 'Dashboard/Widgets/RecentPayments',
  component: RecentPaymentsView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof RecentPaymentsView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
/** A FAILED row is shown with its status and is not in the total. */
export const WithFailedRow: Story = {
  args: {
    data: {
      total_of_shown: data.total_of_shown - 1500,
      items: [item(0, { payment_status: 'FAILED' }), ...data.items.slice(1)],
    },
  },
};
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { total_of_shown: 0, items: [] } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
