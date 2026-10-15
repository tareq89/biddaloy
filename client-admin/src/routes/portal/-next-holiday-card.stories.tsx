import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { NextHolidayCardView } from './-next-holiday-card';

const meta: Meta<typeof NextHolidayCardView> = {
  title: 'Portal/NextHolidayCard',
  component: NextHolidayCardView,
  decorators: [
    withMemoryRouter(['/portal']),
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: {
    variant: 'full',
    month: '2026-11',
    holiday: { name: 'Victory Day', date: '2026-12-16', inDays: 23 },
  },
};
export default meta;
type Story = StoryObj<typeof NextHolidayCardView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = {
  args: { variant: 'compact' },
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
};
export const Today: Story = {
  args: { holiday: { name: 'Victory Day', date: '2026-12-16', inDays: 0 } },
};
export const Empty: Story = { args: { holiday: null } };
export const Loading: Story = { args: { holiday: null, loading: true } };
export const Error: Story = { args: { holiday: null, failed: true, onRetry: () => undefined } };
