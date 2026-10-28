import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { ArrivalNoticesCard } from './-cards';

const row = (over: Record<string, unknown>) => ({
  id: 'sub-1',
  student_id: 's1',
  guardian_id: 'g1',
  student_name: 'Nusrat Jahan',
  guardian_name: 'Karim Uddin',
  status: 'REQUESTED',
  mode: 'ONCE',
  channel: 'PUSH',
  lock: 'NONE',
  consumed_at: null,
  updated_at: '2026-10-29T00:00:00Z',
  ...over,
});

const list = (rows: unknown[]) =>
  http.get('/api/v1/attendance/arrival-subscriptions', () => HttpResponse.json(rows));

const meta: Meta<typeof ArrivalNoticesCard> = {
  title: 'MyClass/ArrivalNoticesCard',
  component: ArrivalNoticesCard,
  args: { sectionId: 'section-1' },
  decorators: [
    (Story) => (
      <div className="w-[390px] md:w-[480px]">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ArrivalNoticesCard>;

export const Waiting: Story = {
  parameters: {
    msw: {
      handlers: [
        list([
          row({}),
          row({ id: 'sub-2', student_name: 'Rima Akter', guardian_name: 'Salma', channel: 'SMS' }),
        ]),
      ],
    },
  },
};

export const WaitingAndActive: Story = {
  globals: { locale: 'bn' },
  parameters: {
    msw: {
      handlers: [
        list([
          row({}),
          row({ id: 'a', status: 'ACTIVE', mode: 'RECURRING', student_name: 'Tania Islam' }),
          row({ id: 'b', status: 'ACTIVE', mode: 'ONCE', consumed_at: '2026-10-28T03:00:00Z' }),
          row({ id: 'c', status: 'ACTIVE', lock: 'ALWAYS', student_name: 'Imran Hossain' }),
        ]),
      ],
    },
  },
};

export const Empty: Story = { parameters: { msw: { handlers: [list([])] } } };
