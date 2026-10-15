import type { Meta, StoryObj } from '@storybook/react-vite';

import { DashboardSection } from './DashboardSection';

/** [8.10.7.2.12] Dashboard settings section. Same precedent as `StudyPlansSection.stories.tsx`. */
const meta: Meta<typeof DashboardSection> = {
  component: DashboardSection,
  args: { schoolId: 'school-1', dashboard: undefined },
};
export default meta;

type Story = StoryObj<typeof DashboardSection>;

export const Defaults: Story = {};

export const StoredValues: Story = {
  args: {
    dashboard: {
      risk: { absentStreakDays: 5, monthlyAttendancePct: 60, failedSubjects: 2, overdueDays: 90 },
      committeeAttendanceTargetPct: 85,
      digestTime: '06:45',
    },
  },
};
