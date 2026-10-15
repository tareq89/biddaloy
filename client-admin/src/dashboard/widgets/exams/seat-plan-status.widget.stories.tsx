import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { SeatPlanStatusView, type SeatPlanStatusDto } from './seat-plan-status.widget';

const exam = (i: number, schedule: number, planned: number, published: number) => ({
  exam_id: `e-${i}`,
  exam_name: `Half Yearly ${i}`,
  class_name: String(5 + i),
  first_date: `2026-11-0${i}`,
  schedule_count: schedule,
  planned_count: planned,
  published_count: published,
});

const data: SeatPlanStatusDto = {
  exams_needing_plan: 2,
  exams: [exam(1, 3, 3, 3), exam(2, 3, 1, 0), exam(3, 3, 0, 0)],
};

const meta: Meta<typeof SeatPlanStatusView> = {
  title: 'Dashboard/Widgets/SeatPlanStatus',
  component: SeatPlanStatusView,
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
type Story = StoryObj<typeof SeatPlanStatusView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { exams_needing_plan: 0, exams: [] } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
