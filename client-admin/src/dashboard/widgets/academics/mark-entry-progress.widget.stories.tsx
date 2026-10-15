import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MarkEntryView, type MarkEntryProgressDto } from './mark-entry-progress.widget';

const cls = (id: string, name: string, submitted: number, percentage: number) => ({
  class_id: id,
  class_name: name,
  exam_id: 'exam-1',
  submitted,
  total: 50,
  percentage,
});

const data: MarkEntryProgressDto = {
  exam_name: 'Half Yearly',
  mark_entry_deadline: '2026-10-20',
  exam_ended_days_ago: null,
  overall: { submitted: 154, total: 200, percentage: 77 },
  classes: [
    cls('c6', '6', 45, 90),
    cls('c7', '7', 40, 80),
    cls('c8', '8', 21, 42),
    cls('c9', '9', 10, 20),
  ],
  lowest_class_id: 'c9',
};

const meta: Meta<typeof MarkEntryView> = {
  title: 'Dashboard/Widgets/MarkEntryProgress',
  component: MarkEntryView,
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
type Story = StoryObj<typeof MarkEntryView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: { data: { ...data, exam_name: null, classes: [], lowest_class_id: null } },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
