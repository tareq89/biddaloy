import type { Meta, StoryObj } from '@storybook/react-vite';

import { RoutineGrid, routineCellKey } from './routine-grid';

/**
 * [21.8.1] Stories the ticket calls out: empty week, full week, conflict
 * state, break rows. Pure/presentational component — no MSW needed.
 */
const meta: Meta<typeof RoutineGrid> = {
  component: RoutineGrid,
};
export default meta;

type Story = StoryObj<typeof RoutineGrid>;

const PERIODS = [
  {
    id: 'p1',
    sequence: 1,
    kind: 'CLASS' as const,
    name: null,
    starts_at: '08:00',
    ends_at: '08:40',
  },
  {
    id: 'break1',
    sequence: 2,
    kind: 'BREAK' as const,
    name: 'Tiffin',
    starts_at: '08:40',
    ends_at: '09:00',
  },
  {
    id: 'p2',
    sequence: 3,
    kind: 'CLASS' as const,
    name: null,
    starts_at: '09:00',
    ends_at: '09:40',
  },
  {
    id: 'p3',
    sequence: 4,
    kind: 'CLASS' as const,
    name: null,
    starts_at: '09:40',
    ends_at: '10:20',
  },
];

const WEEKDAYS = [0, 1, 2, 3, 4]; // Sun–Thu, e.g. a tenant with a Fri/Sat weekend
const WEEKDAY_LABELS = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu' };

const SHARED = {
  weekdays: WEEKDAYS,
  weekdayLabels: WEEKDAY_LABELS,
  periods: PERIODS,
  onActivateCell: () => {},
  onClearCell: () => {},
};

export const EmptyWeek: Story = {
  args: { ...SHARED, cells: {} },
};

const FULL_WEEK_ROWS = [
  { period: PERIODS[0]!, subjectLabel: 'Math', teacherLabels: ['Ms Nahar'] },
  { period: PERIODS[2]!, subjectLabel: 'English', teacherLabels: ['Mr Karim'] },
  { period: PERIODS[3]!, subjectLabel: 'Science', teacherLabels: ['Ms Nahar', 'Mr Karim'] },
];

export const FullWeek: Story = {
  args: {
    ...SHARED,
    cells: Object.fromEntries(
      WEEKDAYS.flatMap((weekday) =>
        FULL_WEEK_ROWS.map(({ period, subjectLabel, teacherLabels }) => [
          routineCellKey(weekday, period.id),
          {
            slotId: `${weekday}-${period.id}`,
            subjectLabel,
            teacherLabels,
            recurrence: 'WEEKLY' as const,
            hasViolation: false,
            hasWarning: false,
          },
        ]),
      ),
    ),
  },
};

export const ConflictState: Story = {
  args: {
    ...SHARED,
    cells: {
      [routineCellKey(0, 'p1')]: {
        slotId: 'a',
        subjectLabel: 'Math',
        teacherLabels: ['Ms Nahar'],
        recurrence: 'WEEKLY',
        hasViolation: true,
        hasWarning: false,
      },
      [routineCellKey(1, 'p1')]: {
        slotId: 'b',
        subjectLabel: 'English',
        teacherLabels: ['Mr Karim'],
        recurrence: 'BIWEEKLY',
        hasViolation: false,
        hasWarning: true,
      },
    },
  },
};

export const BreakRows: Story = {
  args: { ...SHARED, cells: {} },
};
