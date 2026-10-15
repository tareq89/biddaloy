import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import {
  HomeworkSubmissionRateView,
  type HomeworkSubmissionRateDto,
} from './homework-submission-rate.widget';

const cls = (id: string, name: string, submitted: number, assigned: number) => ({
  class_id: id,
  class_name: name,
  submitted,
  assigned,
  percentage: Math.round((submitted / assigned) * 100),
});

const data: HomeworkSubmissionRateDto = {
  window: { from: '2026-10-01', to: '2026-10-07' },
  overall: { submitted: 45, assigned: 60, percentage: 75 },
  classes: [cls('c6', '6', 25, 30), cls('c8', '8', 8, 20), cls('c9', '9', 10, 10)],
};

const meta: Meta<typeof HomeworkSubmissionRateView> = {
  title: 'Dashboard/Widgets/HomeworkSubmissionRate',
  component: HomeworkSubmissionRateView,
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
type Story = StoryObj<typeof HomeworkSubmissionRateView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: { data: { ...data, overall: { submitted: 0, assigned: 0, percentage: 0 }, classes: [] } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
