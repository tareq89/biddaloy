import { AttendanceStatus } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AttendanceMonthGrid, type AttendanceDayCell } from './attendance-month-grid';

const meta: Meta<typeof AttendanceMonthGrid> = {
  title: 'Components/AttendanceMonthGrid',
  component: AttendanceMonthGrid,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AttendanceMonthGrid>;

function day(overrides: Partial<AttendanceDayCell> & { date: string }): AttendanceDayCell {
  return {
    status: null,
    isWorkingDay: true,
    holidayName: null,
    minutesLate: null,
    remarks: null,
    ...overrides,
  };
}

const MONTH = '2026-09';

export const Loading: Story = {
  args: { month: MONTH, days: [], isLoading: true },
};

export const Empty: Story = {
  args: { month: MONTH, days: [] },
};

const typicalArgs: Partial<import('./attendance-month-grid').AttendanceMonthGridProps> = {
  month: MONTH,
  days: [
    day({ date: '2026-09-01', status: AttendanceStatus.PRESENT }),
    day({ date: '2026-09-02', status: AttendanceStatus.PRESENT }),
    day({ date: '2026-09-03', status: AttendanceStatus.LATE, minutesLate: 15 }),
    day({ date: '2026-09-04', status: AttendanceStatus.ABSENT }),
    day({ date: '2026-09-05', isWorkingDay: false }),
    day({ date: '2026-09-06', isWorkingDay: false }),
    day({ date: '2026-09-07', status: AttendanceStatus.LEAVE }),
    day({ date: '2026-09-08', status: AttendanceStatus.PRESENT }),
    day({ date: '2026-09-09', status: null }),
  ],
  onSelectDay: () => {},
};

/** One place in the epic every one of the six states is seen side by
 * side — Present, Late (with minutes), Absent, Leave, Not a school day
 * (weekend), and Not marked (today, still unmarked). */
export const TypicalMonth: Story = {
  args: typicalArgs,
};

export const MonthWithHolidays: Story = {
  args: {
    month: MONTH,
    days: [
      day({ date: '2026-09-01', status: AttendanceStatus.PRESENT }),
      day({
        date: '2026-09-02',
        isWorkingDay: false,
        holidayName: 'Eid-ul-Fitr (observed)',
      }),
      day({ date: '2026-09-03', status: AttendanceStatus.PRESENT }),
    ],
  },
};

export const AllAbsent: Story = {
  args: {
    month: MONTH,
    days: Array.from({ length: 10 }, (_, i) =>
      day({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        status: AttendanceStatus.ABSENT,
      }),
    ),
  },
};

/** Only the first half of the month has been marked — the remaining days
 * render "Not marked" rather than a blank cell. */
export const PartiallyMarked: Story = {
  args: {
    month: MONTH,
    days: Array.from({ length: 12 }, (_, i) =>
      day({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        status: i % 2 === 0 ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT,
      }),
    ),
  },
};

/** `firstDayOfWeek={1}` — the header row and the leading-blank count both
 * rotate, September 2026 starting on Tuesday shifts from 2 leading
 * blanks (Sunday-first) to 1 (Monday-first). */
export const FirstDayMonday: Story = {
  args: {
    month: MONTH,
    firstDayOfWeek: 1,
    days: [
      day({ date: '2026-09-01', status: AttendanceStatus.PRESENT }),
      day({ date: '2026-09-04', status: AttendanceStatus.ABSENT }),
    ],
  },
};

export const Bengali: Story = {
  args: typicalArgs,
  globals: { locale: 'bn' },
};

export const RTL: Story = {
  args: typicalArgs,
  decorators: [rtlDecorator],
};
