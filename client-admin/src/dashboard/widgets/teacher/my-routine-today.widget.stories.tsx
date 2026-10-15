import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MyRoutineTodayView, type MyRoutineTodayDto } from './my-routine-today.widget';

const data: MyRoutineTodayDto = {
  date: '2026-10-07',
  is_working_day: true,
  next_day: null,
  periods: [
    {
      starts_at: '08:00',
      ends_at: '08:40',
      section_id: 's1',
      class_name: '7th',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      room_label: 'Main 202',
      is_homeroom: false,
      covering: false,
      cancelled: false,
    },
    {
      starts_at: '09:00',
      ends_at: '09:40',
      section_id: 's1',
      class_name: '7th',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      room_label: 'Main 202',
      is_homeroom: false,
      covering: false,
      cancelled: false,
    },
    {
      starts_at: '10:30',
      ends_at: '11:10',
      section_id: 's1',
      class_name: '7th',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      room_label: 'Main 202',
      is_homeroom: true,
      covering: false,
      cancelled: false,
    },
    {
      starts_at: '11:20',
      ends_at: '12:00',
      section_id: 's1',
      class_name: '7th',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      room_label: 'Main 202',
      is_homeroom: false,
      covering: false,
      cancelled: true,
    },
    {
      starts_at: '12:10',
      ends_at: '12:50',
      section_id: 's1',
      class_name: '7th',
      section_name: 'B',
      subject_name_en: 'Mathematics',
      subject_name_bn: 'গণিত',
      room_label: 'Main 202',
      is_homeroom: false,
      covering: true,
      cancelled: false,
    },
  ],
};

const meta: Meta<typeof MyRoutineTodayView> = {
  title: 'Dashboard/Widgets/MyRoutineToday',
  component: MyRoutineTodayView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full', nowHhmm: '10:10' },
};
export default meta;
type Story = StoryObj<typeof MyRoutineTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { ...data, periods: [] } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
