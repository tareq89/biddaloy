import { CalendarEventType } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AgendaList, type AgendaEvent } from './agenda-list';

/**
 * [17.4.2] Mobile/narrow-viewport agenda — presentational, no data hooks,
 * same "client-admin isn't globbed into a running Storybook instance yet"
 * precedent as `MonthGrid.stories.tsx`.
 */
const meta: Meta<typeof AgendaList> = {
  component: AgendaList,
  args: {
    formatDayHeading: (day: string) => day,
  },
};
export default meta;

type Story = StoryObj<typeof AgendaList>;

const SAMPLE_EVENTS: AgendaEvent[] = [
  {
    id: 'e1',
    type: CalendarEventType.MEETING,
    typeLabel: 'Meeting',
    name: 'Parent-teacher meeting',
    startDate: '2026-09-10',
    endDate: '2026-09-10',
  },
  {
    id: 'e2',
    type: CalendarEventType.EXAM,
    typeLabel: 'Exam',
    name: 'Mid-term exams',
    startDate: '2026-09-12',
    endDate: '2026-09-14',
  },
];

export const Populated: Story = {
  args: { events: SAMPLE_EVENTS, emptyLabel: 'No events in this range.' },
};

export const Empty: Story = {
  args: { events: [], emptyLabel: 'No events in this range.' },
};

/**
 * A term-long holiday spans several days outside the day any other event
 * starts on. It must show up under every day it covers — 10, 11, 12 —
 * not just its `startDate` of the 10th, which is the bug this story
 * guards against (see `agenda-list.tsx`'s day-coverage grouping).
 */
export const MultiDayEvent: Story = {
  args: {
    events: [
      {
        id: 'holiday-1',
        type: CalendarEventType.HOLIDAY,
        typeLabel: 'Holiday',
        name: 'Term break',
        startDate: '2026-09-10',
        endDate: '2026-09-12',
      },
      {
        id: 'meeting-1',
        type: CalendarEventType.MEETING,
        typeLabel: 'Meeting',
        name: 'Staff meeting',
        startDate: '2026-09-11',
        endDate: '2026-09-11',
      },
    ],
    emptyLabel: 'No events in this range.',
  },
};
