import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';

import { CloseYearDialog } from './-close-year-dialog';

/** S2 Close year. Same "client-admin is not globbed into Storybook yet" note as
 * `-terms-tab-view.stories.tsx`; written anyway so it is ready once that is wired. */
const meta: Meta<typeof CloseYearDialog> = {
  component: CloseYearDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    academicYearId: 'year-1',
    academicYearName: '2026',
    onClosed: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof CloseYearDialog>;

const NORMAL = {
  blocks: [],
  warnings: [
    { code: 'CLASSES_NOT_PROMOTED', count: 2 },
    { code: 'DUES_OUTSTANDING', count: 150000 },
  ],
  freezes: [
    { table: 'exams', count: 12 },
    { table: 'student_fees', count: 340 },
    { table: 'attendance_sessions', count: 210 },
    { table: 'enrollments', count: 480 },
  ],
};

const preview = (body: Record<string, unknown>, wait = 0) =>
  http.get('/api/v1/academic-years/:id/close-preview', async () => {
    if (wait) await delay(wait);
    return HttpResponse.json(body);
  });

/** What will freeze, plus the things worth checking first. */
export const Normal: Story = { parameters: { msw: { handlers: [preview(NORMAL)] } } };

/** An open promotion draft: red notice, Close year is off. */
export const Blocked: Story = {
  parameters: {
    msw: {
      handlers: [preview({ ...NORMAL, blocks: [{ code: 'DRAFT_PROMOTION_RUN_OPEN', count: 1 }] })],
    },
  },
};

/** The preview is still loading. */
export const Loading: Story = { parameters: { msw: { handlers: [preview(NORMAL, 60_000)] } } };
