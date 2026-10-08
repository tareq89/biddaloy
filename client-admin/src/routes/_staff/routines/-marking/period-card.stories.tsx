import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../../ui/.storybook/router-decorator';

import { PeriodCard, type PeriodCardProps } from './period-card';
import type { MarkingPeriod } from './types';

setActiveRole('TEACHER');

const base: MarkingPeriod = {
  section: { id: 'section-1', name: '7-B' },
  subject: { id: 'subject-math', name_en: 'Maths', name_bn: 'গণিত' },
  period_slot_id: 'period-3',
  sequence: 3,
  starts_at: '09:20:00',
  ends_at: '10:00:00',
  routine_slot_id: 'slot-1',
  substituting: false,
  cancelled: false,
  plan_id: 'plan-1',
  lesson: { id: 'lesson-12', number: 12, title: 'ভগ্নাংশের যোগ', part: 2, of: 3 },
  delivery: null,
  can_mark: true,
};

const reported = {
  id: 'd1',
  status: 'TAUGHT' as const,
  reason: null,
  note: null,
  is_extra: false,
  auto: false,
  recorded_at: '2026-10-09T02:42:00.000Z',
};

const props = (period: MarkingPeriod): PeriodCardProps => ({
  period,
  date: '2026-10-09',
  sectionLabel: '৭ম-খ',
  subjectLabel: 'গণিত',
  roomLabel: 'কক্ষ ২০৬',
  canMakePlan: true,
});

const meta: Meta<typeof PeriodCard> = {
  title: 'Routines/PeriodCard',
  component: PeriodCard,
  decorators: [withMemoryRouter(['/routines/my'])],
  parameters: {
    msw: {
      handlers: [http.put('/api/v1/lesson-deliveries', () => HttpResponse.json(reported))],
    },
  },
};

export default meta;
type Story = StoryObj<typeof PeriodCard>;

/** Not reported yet: the three status buttons. */
export const Unmarked: Story = { args: props(base) };
export const Reported: Story = { args: props({ ...base, delivery: reported }) };
export const NoPlan: Story = { args: props({ ...base, plan_id: null }) };
export const AutoCancelled: Story = {
  args: props({
    ...base,
    cancelled: true,
    delivery: { ...reported, status: 'NOT_TAUGHT', reason: 'CANCELLED', auto: true },
  }),
};
export const WindowClosed: Story = {
  args: props({ ...base, delivery: reported, can_mark: false }),
};

/** Phone: 56px stacked status buttons. */
export const UnmarkedPhone: Story = {
  args: props(base),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const ReportedPhone: Story = {
  args: props({ ...base, delivery: reported }),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
