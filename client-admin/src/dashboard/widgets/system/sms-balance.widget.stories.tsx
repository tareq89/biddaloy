import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { SmsBalanceView, type SmsBalanceDto } from './sms-balance.widget';

const data: SmsBalanceDto = { metering: 'PLATFORM', available: 1240, reserved: 60 };

const meta: Meta<typeof SmsBalanceView> = {
  title: 'Dashboard/Widgets/SmsBalance',
  component: SmsBalanceView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof SmsBalanceView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const NotMetered: Story = {
  args: { data: { metering: 'OFF', available: 0, reserved: 0 } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
