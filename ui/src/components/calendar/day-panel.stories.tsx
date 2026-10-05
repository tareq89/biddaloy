import { CalendarEventType } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DayPanel } from './day-panel';

const meta: Meta<typeof DayPanel> = {
  title: 'Components/Calendar/DayPanel',
  component: DayPanel,
  tags: ['autodocs'],
  args: { date: '2026-09-10' },
};

export default meta;
type Story = StoryObj<typeof DayPanel>;

export const NoEvents: Story = { args: { events: [] } };
export const ThreeEvents: Story = {
  args: {
    onEventClick: () => {},
    events: [
      {
        id: 'e1',
        type: CalendarEventType.HOLIDAY,
        typeLabel: 'Holiday',
        name: 'জাতীয় দিবস',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      },
      {
        id: 'e2',
        type: CalendarEventType.EXAM,
        typeLabel: 'Exam',
        name: 'Mid-term exams',
        startDate: '2026-09-08',
        endDate: '2026-09-12',
      },
      {
        id: 'e3',
        type: CalendarEventType.MEETING,
        typeLabel: 'Meeting',
        name: 'অভিভাবক সভা',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      },
    ],
  },
};
