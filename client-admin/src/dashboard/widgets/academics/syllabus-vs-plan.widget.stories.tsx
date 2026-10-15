import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { SyllabusVsPlanView, type SyllabusVsPlanDto } from './syllabus-vs-plan.widget';

const cls = (id: string, name: string, done: number, expected: number, notUpdated: number) => ({
  class_id: id,
  class_name: name,
  done_percentage: done,
  expected_percentage: expected,
  behind_by: Math.max(0, expected - done),
  not_updated: notUpdated,
});

const data: SyllabusVsPlanDto = {
  as_of: '2026-10-07',
  behind_count: 2,
  not_updated_count: 7,
  classes: [cls('c6', '6', 66, 60, 0), cls('c8', '8', 41, 60, 3), cls('c9', '9', 50, 62, 4)],
};

const meta: Meta<typeof SyllabusVsPlanView> = {
  title: 'Dashboard/Widgets/SyllabusVsPlan',
  component: SyllabusVsPlanView,
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
type Story = StoryObj<typeof SyllabusVsPlanView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: { data: { as_of: '2026-10-07', behind_count: 0, not_updated_count: 0, classes: [] } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
