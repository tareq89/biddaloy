import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { SyllabusView, type SyllabusProgressDto } from './syllabus-progress.widget';

const cls = (
  id: string,
  name: string,
  done: number,
  percentage: number,
  expected_percentage: number | null = null,
) => ({
  class_id: id,
  class_name: name,
  done,
  in_progress: 2,
  total: 100,
  percentage,
  expected_percentage,
});

const data: SyllabusProgressDto = {
  classes: [cls('c6', '6', 80, 80), cls('c8', '8', 41, 41), cls('c9', '9', 65, 65)],
  overall: { done: 186, total: 300, percentage: 62 },
  behind_count: 0,
};

const withPlan: SyllabusProgressDto = {
  classes: [cls('c6', '6', 80, 80, 60), cls('c8', '8', 41, 41, 60), cls('c9', '9', 65, 65, 60)],
  overall: { done: 186, total: 300, percentage: 62 },
  behind_count: 1,
};

const meta: Meta<typeof SyllabusView> = {
  title: 'Dashboard/Widgets/SyllabusProgress',
  component: SyllabusView,
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
type Story = StoryObj<typeof SyllabusView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const WithExpectedMarker: Story = { args: { data: withPlan } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: { data: { classes: [], overall: { done: 0, total: 0, percentage: 0 }, behind_count: 0 } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
