import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { ArrivalNoticeCard } from './-arrival-notice-card';

const sub = (over: Record<string, unknown>) => ({
  id: 's',
  student_id: 'k',
  guardian_id: 'g',
  status: 'REQUESTED',
  mode: 'ONCE',
  channel: 'PUSH',
  lock: 'NONE',
  consumed_at: null,
  updated_at: '2026-11-01T10:00:00.000Z',
  ...over,
});

function handler(subscription: unknown, smsAllowed = true) {
  return {
    msw: {
      handlers: [
        http.get('/api/v1/portal/arrival-subscriptions', () =>
          HttpResponse.json({
            school: { enabled: true, smsAllowed },
            children: [{ student_id: 'k', student_name: 'Fatima Rahman', subscription }],
          }),
        ),
      ],
    },
  };
}

const meta = {
  title: 'Portal/ArrivalNoticeCard',
  component: ArrivalNoticeCard,
  decorators: [withMemoryRouter(['/portal'])],
} satisfies Meta<typeof ArrivalNoticeCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = { parameters: handler(sub({})) };
export const EveryDay: Story = {
  parameters: handler(sub({ status: 'ACTIVE', mode: 'RECURRING' })),
};
export const Done: Story = {
  parameters: handler(sub({ status: 'OFF', consumed_at: '2026-11-02T08:00:00.000Z' })),
};
export const Locked: Story = { parameters: handler(sub({ status: 'OFF', lock: 'NEVER' })) };
export const SmsNotAllowed: Story = { parameters: handler(sub({}), false) };
