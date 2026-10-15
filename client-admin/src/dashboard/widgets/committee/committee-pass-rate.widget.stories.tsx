import type { Meta, StoryObj } from '@storybook/react-vite';

import { CommitteePassRateView, type CommitteePassRateDto } from './committee-pass-rate.widget';

const data: CommitteePassRateDto = {
  exam_name: 'Half-yearly 2026',
  classes: [
    { class_name: '6', numeric_grade: 6, appeared: 120, pass_percentage: 94 },
    { class_name: '7', numeric_grade: 7, appeared: 118, pass_percentage: 81.5 },
    { class_name: '8', numeric_grade: 8, appeared: 110, pass_percentage: 90 },
  ],
  overall_pass_percentage: 88.5,
  recent_rounds: [
    { exam_name: 'Annual 2025', pass_percentage: 85 },
    { exam_name: 'Half-yearly 2026', pass_percentage: 88.5 },
  ],
  previous_pass_percentage: 85,
};

const meta: Meta<typeof CommitteePassRateView> = {
  title: 'Dashboard/Widgets/CommitteePassRate',
  component: CommitteePassRateView,
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
type Story = StoryObj<typeof CommitteePassRateView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: { data: { ...data, exam_name: null, classes: [], overall_pass_percentage: null } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
