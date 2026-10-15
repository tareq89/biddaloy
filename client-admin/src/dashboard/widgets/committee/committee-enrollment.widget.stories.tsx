import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  CommitteeEnrollmentView,
  type CommitteeEnrollmentDto,
} from './committee-enrollment.widget';

const data: CommitteeEnrollmentDto = {
  years: [
    { year_label: '2022', student_count: 1104 },
    { year_label: '2023', student_count: 1150 },
    { year_label: '2024', student_count: 1180 },
    { year_label: '2025', student_count: 1214 },
    { year_label: '2026', student_count: 1248 },
  ],
  current_count: 1248,
  previous_count: 1214,
};

const meta: Meta<typeof CommitteeEnrollmentView> = {
  title: 'Dashboard/Widgets/CommitteeEnrollment',
  component: CommitteeEnrollmentView,
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
type Story = StoryObj<typeof CommitteeEnrollmentView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = { args: { data: { years: [], current_count: 0, previous_count: null } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
