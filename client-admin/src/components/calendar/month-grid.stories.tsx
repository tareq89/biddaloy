import { CalendarEventType } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MonthGrid, type MonthGridEvent } from './month-grid';

/**
 * [17.4.2]'s month grid — presentational, no data hooks. Same
 * "client-admin isn't globbed into a running Storybook instance yet"
 * precedent as `CalendarSection.stories.tsx`.
 */
const meta: Meta<typeof MonthGrid> = {
  component: MonthGrid,
  args: {
    month: '2026-09',
    firstDayOfWeek: 0,
    weeklyOffDays: [5, 6],
    weekdayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    moreLabel: (count: number) => `+${count} more`,
  },
};
export default meta;

type Story = StoryObj<typeof MonthGrid>;

const SAMPLE_EVENTS: MonthGridEvent[] = [
  {
    id: 'e1',
    type: CalendarEventType.HOLIDAY,
    typeLabel: 'Holiday',
    name: 'National Day',
    startDate: '2026-09-05',
    endDate: '2026-09-05',
  },
  {
    id: 'e2',
    type: CalendarEventType.EXAM,
    typeLabel: 'Exam',
    name: 'Mid-term exams',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
  },
  {
    id: 'e3',
    type: CalendarEventType.MEETING,
    typeLabel: 'Meeting',
    name: 'Parent-teacher meeting',
    startDate: '2026-09-10',
    endDate: '2026-09-10',
  },
  {
    id: 'e4',
    type: CalendarEventType.EVENT,
    typeLabel: 'Event',
    name: 'Sports day',
    startDate: '2026-09-10',
    endDate: '2026-09-10',
  },
];

export const Populated: Story = {
  args: { events: SAMPLE_EVENTS },
};

export const Empty: Story = {
  args: { events: [] },
};

export const WithTermBands: Story = {
  args: {
    events: SAMPLE_EVENTS,
    terms: [{ id: 't1', name: 'Term 2', startDate: '2026-09-01', endDate: '2026-11-30' }],
  },
};

export const FirstDayMonday: Story = {
  args: {
    events: SAMPLE_EVENTS,
    firstDayOfWeek: 1,
    weeklyOffDays: [5],
  },
};
