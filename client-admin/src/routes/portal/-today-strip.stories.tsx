import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { TodayStrip } from './-today-strip';

const TODAY = '2026-11-23';
const FATIMA = { id: 'kid-a', fullName: 'Fatima Rahman', meta: 'Class 8 B · Roll 14' };
const IMRAN = { id: 'kid-b', fullName: 'Imran Rahman', meta: 'Class 3 A · Roll 7' };

/** One child's days endpoint: only today's row matters to the strip. */
function days(
  byChild: Record<string, { status: string | null; working?: boolean; markedAt?: string }>,
) {
  return http.get('/api/v1/attendance/students/:id/days', ({ params }) => {
    const row = byChild[String(params.id)] ?? { status: null };
    return HttpResponse.json([
      {
        date: TODAY,
        status: row.status,
        minutes_late: null,
        remarks: null,
        is_working_day: row.working ?? true,
        holiday_name: null,
        marked_at: row.markedAt ?? null,
      },
    ]);
  });
}

const meta: Meta<typeof TodayStrip> = {
  title: 'Portal/TodayStrip',
  component: TodayStrip,
  args: { students: [FATIMA, IMRAN], today: TODAY, month: '2026-11' },
  parameters: {
    msw: {
      handlers: [
        days({
          'kid-a': { status: 'PRESENT', markedAt: '2026-11-23T02:10:00.000Z' },
          'kid-b': { status: 'ABSENT', markedAt: '2026-11-23T02:10:00.000Z' },
        }),
      ],
    },
  },
};
export default meta;
type Story = StoryObj<typeof TodayStrip>;

export const TwoChildren: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const OneChild: Story = { args: { students: [FATIMA] } };
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
};
export const LateAndLeave: Story = {
  parameters: {
    msw: { handlers: [days({ 'kid-a': { status: 'LATE' }, 'kid-b': { status: 'LEAVE' } })] },
  },
};
export const NotTakenYet: Story = {
  parameters: {
    msw: { handlers: [days({ 'kid-a': { status: null }, 'kid-b': { status: null } })] },
  },
};
export const SchoolClosed: Story = {
  parameters: {
    msw: {
      handlers: [
        days({
          'kid-a': { status: null, working: false },
          'kid-b': { status: null, working: false },
        }),
      ],
    },
  },
};
