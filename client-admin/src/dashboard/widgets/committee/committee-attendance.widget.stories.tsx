import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  CommitteeAttendanceView,
  type CommitteeAttendanceDto,
} from './committee-attendance.widget';

const data: CommitteeAttendanceDto = {
  months: [
    { month: '2026-07', percentage: 91 },
    { month: '2026-08', percentage: null },
    { month: '2026-09', percentage: 86.5 },
    { month: '2026-10', percentage: 89 },
  ],
  current_month_percentage: 89,
  year_percentage: 88.1,
  target_percentage: 90,
};

const meta: Meta<typeof CommitteeAttendanceView> = {
  title: 'Dashboard/Widgets/CommitteeAttendance',
  component: CommitteeAttendanceView,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full', updatedLabel: 'Updated just now' },
};
export default meta;
type Story = StoryObj<typeof CommitteeAttendanceView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: {
    data: {
      ...data,
      months: [{ month: '2026-10', percentage: null }],
      current_month_percentage: null,
      year_percentage: null,
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
