import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { RemindersPendingView, type RemindersPendingDto } from './reminders-pending.widget';

const data: RemindersPendingDto = {
  student_count: 38,
  guardian_count: 31,
  oldest_threshold_date: '2026-09-10',
};

const meta: Meta<typeof RemindersPendingView> = {
  title: 'Dashboard/Widgets/RemindersPending',
  component: RemindersPendingView,
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
type Story = StoryObj<typeof RemindersPendingView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: { data: { student_count: 0, guardian_count: 0, oldest_threshold_date: null } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
