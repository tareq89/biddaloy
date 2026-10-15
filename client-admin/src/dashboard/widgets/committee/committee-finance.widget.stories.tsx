import type { Meta, StoryObj } from '@storybook/react-vite';

import { CommitteeFinanceView, type CommitteeFinanceDto } from './committee-finance.widget';

const figure = (received_pct: number | null) => ({
  as_of: '2026-10-07',
  received: 700000,
  billed_for_month: 1000000,
  received_pct,
});
const data: CommitteeFinanceDto = {
  months: [
    { month: '2026-07', billed: 1000000, paid: 900000, outstanding: 100000 },
    { month: '2026-08', billed: 1000000, paid: 800000, outstanding: 200000 },
    { month: '2026-09', billed: 1000000, paid: 600000, outstanding: 400000 },
    { month: '2026-10', billed: 1000000, paid: 300000, outstanding: 345000 },
  ],
  year_outstanding: 1045000,
  current_month: {
    ...figure(70),
    month: '2026-10',
    last_month_same_point: figure(65),
    last_year_same_point: figure(62),
  },
};

const meta: Meta<typeof CommitteeFinanceView> = {
  title: 'Dashboard/Widgets/CommitteeFinance',
  component: CommitteeFinanceView,
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full', updatedLabel: 'Updated just now' },
};
export default meta;
type Story = StoryObj<typeof CommitteeFinanceView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Phone: Story = {
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  parameters: { viewport: { defaultViewport: 'mobile2' } },
};
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const TileNoLastYear: Story = {
  args: {
    variant: 'tile',
    data: { ...data, current_month: { ...data.current_month, last_year_same_point: null } },
  },
};
export const Empty: Story = { args: { data: { ...data, months: [], year_outstanding: 0 } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
