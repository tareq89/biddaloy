import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MyPendingSectionsView, type MyPendingSectionsDto } from './my-pending-sections.widget';

const data: MyPendingSectionsDto = {
  date: '2026-10-07',
  is_working_day: true,
  pending_count: 1,
  sections: [
    {
      section_id: 's-b',
      class_name: '7',
      section_name: 'B',
      student_count: 40,
      taken: false,
      unmarked: 40,
    },
    {
      section_id: 's-a',
      class_name: '7',
      section_name: 'A',
      student_count: 40,
      taken: true,
      unmarked: 0,
    },
    {
      section_id: 's-c',
      class_name: '7',
      section_name: 'C',
      student_count: 40,
      taken: true,
      unmarked: 0,
    },
  ],
};

const meta: Meta<typeof MyPendingSectionsView> = {
  title: 'Dashboard/Widgets/MyPendingSections',
  component: MyPendingSectionsView,
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
type Story = StoryObj<typeof MyPendingSectionsView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: {
    data: {
      ...data,
      pending_count: 0,
      sections: data.sections.map((s) => ({ ...s, taken: true })),
    },
  },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
