import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MyMarkDeadlinesView, type MyMarkDeadlinesDto } from './my-mark-deadlines.widget';

const data: MyMarkDeadlinesDto = {
  outstanding_students: 8,
  items: [
    {
      exam_id: 'e1',
      exam_name: 'Half-yearly',
      section_id: 's1',
      class_name: '7',
      section_name: 'A',
      subject_id: 'sub1',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      entered: 32,
      expected: 40,
      state: 'DRAFT',
      mark_entry_deadline: '2026-10-10',
      last_sitting_date: null,
    },
    {
      exam_id: 'e1',
      exam_name: 'Half-yearly',
      section_id: 's1',
      class_name: '7',
      section_name: 'A',
      subject_id: 'sub1',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      entered: 40,
      expected: 40,
      state: 'SUBMITTED',
      mark_entry_deadline: '2026-10-10',
      last_sitting_date: null,
    },
  ],
};

const meta: Meta<typeof MyMarkDeadlinesView> = {
  title: 'Dashboard/Widgets/MyMarkDeadlines',
  component: MyMarkDeadlinesView,
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
type Story = StoryObj<typeof MyMarkDeadlinesView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = { args: { data: { outstanding_students: 0, items: [] } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
