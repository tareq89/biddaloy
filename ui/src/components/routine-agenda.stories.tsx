import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { RoutineAgenda, type RoutineAgendaDay } from './routine-agenda';

/**
 * [21.10.1] Stories the ticket calls out: normal day, covering day,
 * holiday, empty. Pure/presentational component — no MSW needed.
 */
const meta: Meta<typeof RoutineAgenda> = {
  component: RoutineAgenda,
};
export default meta;

type Story = StoryObj<typeof RoutineAgenda>;

function Wrapper({ days }: { days: RoutineAgendaDay[] }) {
  const [selectedDate, setSelectedDate] = React.useState(days[0]!.date);
  const [weekView, setWeekView] = React.useState(false);
  return (
    <RoutineAgenda
      days={days}
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
      weekView={weekView}
      onToggleWeekView={setWeekView}
    />
  );
}

const BASE_DAYS: RoutineAgendaDay[] = [
  { date: '2026-09-23', weekdayLabel: 'Wed', isToday: true, items: [] },
  { date: '2026-09-24', weekdayLabel: 'Thu', isToday: false, items: [] },
  { date: '2026-09-25', weekdayLabel: 'Fri', isToday: false, items: [] },
];

export const NormalDay: Story = {
  render: () => (
    <Wrapper
      days={BASE_DAYS.map((day, i) =>
        i === 0
          ? {
              ...day,
              items: [
                {
                  slotId: 'p1',
                  periodLabel: 'Period 1',
                  startsAt: '10:00',
                  endsAt: '10:40',
                  sectionLabel: 'Class 6A',
                  subjectLabel: 'English',
                  roomLabel: 'Room 12',
                  cancelled: false,
                },
              ],
            }
          : day,
      )}
    />
  ),
};

export const CoveringDay: Story = {
  render: () => (
    <Wrapper
      days={BASE_DAYS.map((day, i) =>
        i === 0
          ? {
              ...day,
              items: [
                {
                  slotId: 'p1',
                  periodLabel: 'Period 2',
                  startsAt: '10:40',
                  endsAt: '11:20',
                  sectionLabel: 'Class 7B',
                  subjectLabel: 'Math',
                  roomLabel: 'Room 4',
                  cancelled: false,
                  coveringForLabel: 'Covering for Ms Nahar',
                },
                {
                  slotId: 'p2',
                  periodLabel: 'Period 3',
                  startsAt: '11:20',
                  endsAt: '12:00',
                  sectionLabel: 'Class 8A',
                  subjectLabel: 'Science',
                  roomLabel: null,
                  cancelled: true,
                },
              ],
            }
          : day,
      )}
    />
  ),
};

export const Holiday: Story = {
  render: () => (
    <Wrapper
      days={BASE_DAYS.map((day, i) => (i === 0 ? { ...day, offReason: 'Holiday — Eid ul-Fitr' } : day))}
    />
  ),
};

export const Empty: Story = {
  render: () => <Wrapper days={BASE_DAYS} />,
};
