import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { HomeworkToCheckView, type HomeworkToCheckDto } from './homework-to-check.widget';

const data: HomeworkToCheckDto = {
  total_submitted: 18,
  assignment_count: 2,
  items: [
    {
      assignment_id: 'a1',
      homework_id: 'h1',
      title: 'Chapter 3 sums',
      class_name: '7',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      due_date: '2026-10-06',
      submitted_count: 11,
    },
    {
      assignment_id: 'a2',
      homework_id: 'h2',
      title: 'Essay',
      class_name: '7',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      due_date: '2026-10-06',
      submitted_count: 7,
    },
  ],
};

const meta: Meta<typeof HomeworkToCheckView> = {
  title: 'Dashboard/Widgets/HomeworkToCheck',
  component: HomeworkToCheckView,
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
type Story = StoryObj<typeof HomeworkToCheckView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: { data: { total_submitted: 0, assignment_count: 0, items: [] } },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
