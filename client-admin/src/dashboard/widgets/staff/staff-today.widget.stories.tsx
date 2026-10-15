import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { StaffTodayView, type StaffTodayDto } from './staff-today.widget';

const leave = (n: number): StaffTodayDto['on_leave'] =>
  Array.from({ length: n }, (_, i) => ({
    staff_profile_id: `00000000-0000-4000-8000-00000000000${i}`,
    full_name: ['রাশেদা পারভীন', 'Karim Uddin', 'Nasrin Akter', 'Habib Rahman'][i % 4]!,
    leave_type: (['SICK', 'CASUAL', 'MATERNITY'] as const)[i % 3]!,
    end_date: '2026-10-09',
  }));
const data: StaffTodayDto = {
  date: '2026-10-07',
  staff_total: 45,
  present: 40,
  late: 2,
  absent: 0,
  leave: 3,
  unmarked: 0,
  absent_without_leave: 0,
  on_leave: leave(3),
};

const meta: Meta<typeof StaffTodayView> = {
  title: 'Dashboard/Widgets/StaffToday',
  component: StaffTodayView,
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
type Story = StoryObj<typeof StaffTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const ManyOnLeave: Story = { args: { data: { ...data, leave: 7, on_leave: leave(7) } } };
export const Empty: Story = {
  args: { data: { ...data, present: 0, late: 0, leave: 0, unmarked: 45, on_leave: [] } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
