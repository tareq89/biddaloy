import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MyLeaveBalanceView, type MyLeaveBalanceDto } from './my-leave-balance.widget';

const data: MyLeaveBalanceDto = {
  has_profile: true,
  year: 2026,
  total_quota_days: 12,
  total_used_days: 4,
  total_balance_days: 8,
  by_type: [],
};

const meta: Meta<typeof MyLeaveBalanceView> = {
  title: 'Dashboard/Widgets/MyLeaveBalance',
  component: MyLeaveBalanceView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof MyLeaveBalanceView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = { args: { data: { ...data, has_profile: false } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
