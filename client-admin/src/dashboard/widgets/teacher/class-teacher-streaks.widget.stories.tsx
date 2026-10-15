import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import {
  ClassTeacherStreaksView,
  type ClassTeacherStreaksDto,
} from './class-teacher-streaks.widget';

const data: ClassTeacherStreaksDto = {
  section: { section_id: 'sec1', class_name: '7', section_name: 'B' },
  as_of_date: '2026-10-06',
  total: 3,
  items: [
    {
      student_id: '1',
      student_name: 'Rafi Ahmed',
      roll_number: 4,
      length: 6,
      since_date: '2026-09-30',
    },
    {
      student_id: '2',
      student_name: 'Tania Akter',
      roll_number: 9,
      length: 4,
      since_date: '2026-09-30',
    },
    {
      student_id: '3',
      student_name: 'Sumon Das',
      roll_number: 12,
      length: 3,
      since_date: '2026-09-30',
    },
  ],
};

const meta: Meta<typeof ClassTeacherStreaksView> = {
  title: 'Dashboard/Widgets/ClassTeacherStreaks',
  component: ClassTeacherStreaksView,
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
type Story = StoryObj<typeof ClassTeacherStreaksView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = {
  args: { data: { section: null, as_of_date: null, total: 0, items: [] } },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
