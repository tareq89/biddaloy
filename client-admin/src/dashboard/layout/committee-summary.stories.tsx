import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';

import { CommitteeSummary } from './committee-summary';

const point = (received_pct: number) => ({
  as_of: '2026-10-07',
  received: 1,
  billed_for_month: 1,
  received_pct,
});
const attendance = (current: number) => ({
  months: [{ month: '2026-10', percentage: current }],
  current_month_percentage: current,
  year_percentage: current,
  target_percentage: 90,
});
const finance = (now: number, lastYear: number | null) => ({
  months: [],
  year_outstanding: 0,
  current_month: {
    ...point(now),
    month: '2026-10',
    last_month_same_point: null,
    last_year_same_point: lastYear === null ? null : point(lastYear),
  },
});
const handlers = (a: object, f: object, slow = false) => [
  http.get('/api/v1/dashboard/widgets/committee-attendance', async () => {
    if (slow) await delay('infinite');
    return HttpResponse.json(a);
  }),
  http.get('/api/v1/dashboard/widgets/committee-finance', () => HttpResponse.json(f)),
];

const meta: Meta<typeof CommitteeSummary> = {
  title: 'Dashboard/CommitteeSummary',
  component: CommitteeSummary,
};
export default meta;
type Story = StoryObj<typeof CommitteeSummary>;

export const NearTargetAndAhead: Story = {
  parameters: { msw: { handlers: handlers(attendance(89), finance(70, 62)) } },
};
export const BelowTargetAndBehind: Story = {
  globals: { locale: 'bn', theme: 'dark' },
  parameters: { msw: { handlers: handlers(attendance(80), finance(50, 62)) } },
};
export const NoLastYear: Story = {
  parameters: { msw: { handlers: handlers(attendance(91), finance(70, null)) } },
};
export const Loading: Story = {
  parameters: { msw: { handlers: handlers(attendance(89), finance(70, 62), true) } },
};
