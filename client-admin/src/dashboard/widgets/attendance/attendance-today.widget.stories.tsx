import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { AttendanceTodayView, type AttendanceTodayDto } from './attendance-today.widget';

const data: AttendanceTodayDto = {
  date: '2026-10-07',
  is_working_day: true,
  percentage: 91.4,
  counts: { present: 820, late: 14, absent: 79, leave: 6, unmarked: 31 },
  sections_total: 24,
  pending_sections: [{ section_id: 's1', class_name: '7', section_name: 'B' }],
  week_ago_percentage: 89.4,
  series: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 8).padStart(2, '0')}`,
    percentage: i === 5 ? null : 86.8 + ((i * 7) % 6),
  })),
};

const meta: Meta<typeof AttendanceTodayView> = {
  title: 'Dashboard/Widgets/AttendanceToday',
  component: AttendanceTodayView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full', updatedLabel: 'Updated just now' },
};
export default meta;
type Story = StoryObj<typeof AttendanceTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const ClosedToday: Story = {
  args: { data: { ...data, is_working_day: false, percentage: null } },
};
export const Empty: Story = {
  args: {
    data: {
      ...data,
      percentage: null,
      counts: { present: 0, late: 0, absent: 0, leave: 0, unmarked: 855 },
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
