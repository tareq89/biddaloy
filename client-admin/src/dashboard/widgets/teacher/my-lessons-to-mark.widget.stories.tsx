import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MyLessonsToMarkView, type MyLessonsToMarkDto } from './my-lessons-to-mark.widget';

const row = (planned_on: string, lesson_title: string | null) => ({
  class_name: '7',
  section_name: 'B',
  subject_name_en: 'Mathematics',
  subject_name_bn: 'গণিত',
  planned_on,
  lesson_title,
});
const data: MyLessonsToMarkDto = {
  to_mark: 3,
  oldest_planned_on: '2026-10-05',
  items: [
    row('2026-10-07', 'অনুশীলনী ৫.৩'),
    row('2026-10-06', null),
    row('2026-10-05', 'অনুশীলনী ৫.২'),
  ],
};

const meta: Meta<typeof MyLessonsToMarkView> = {
  title: 'Dashboard/Widgets/MyLessonsToMark',
  component: MyLessonsToMarkView,
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
type Story = StoryObj<typeof MyLessonsToMarkView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const AllMarked: Story = {
  args: { data: { to_mark: 0, oldest_planned_on: null, items: [] } },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
