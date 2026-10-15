import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { CollectionByMonthView, type CollectionByMonthDto } from './collection-by-month.widget';

const NETS = [90000, 85000, 120000, 100000, 95000, 110000, 70000, 60000, 130000];
const data: CollectionByMonthDto = {
  year: 2026,
  year_to_date_net: 1000000,
  month_to_date_net: 48500,
  previous_month_same_days_net: 41200,
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    net: i < 9 ? NETS[i]! : i === 9 ? 48500 : null,
    is_current: i === 9,
  })),
};

const meta: Meta<typeof CollectionByMonthView> = {
  title: 'Dashboard/Widgets/CollectionByMonth',
  component: CollectionByMonthView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof CollectionByMonthView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: {
    data: {
      ...data,
      year_to_date_net: 0,
      month_to_date_net: 0,
      previous_month_same_days_net: 0,
      months: data.months.map((m) => ({ ...m, net: m.net === null ? null : 0 })),
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
