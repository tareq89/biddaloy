import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import type { PlatformSchoolBillingDetail, SeatOrderDto } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchoolBillingView } from './school-billing-view';

/** Epic 49 W4: one school's seats and orders. States: loading, error, empty, populated, idle. */
const meta: Meta<typeof SchoolBillingView> = {
  component: SchoolBillingView,
  args: {
    loading: false,
    onRetry: () => {},
    onGrant: () => {},
    onRecordPayment: () => {},
    onRevive: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof SchoolBillingView>;

const order = (over: Partial<SeatOrderDto> = {}): SeatOrderDto => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  school_id: '00000000-0000-4000-8000-000000000001',
  seats: 300,
  months: 3,
  unit_price_paisa: 1000,
  amount_paisa: 900_000,
  period_start: '2026-10-20',
  period_end: '2027-01-20',
  status: SeatOrderStatus.PENDING,
  method: null,
  paid_at: null,
  created_at: '2026-10-20T04:00:00.000Z',
  ...over,
});

const detail: PlatformSchoolBillingDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ananta School',
  status: 'ACTIVE',
  status_reason: null,
  deleted: false,
  seats_entitled: 300,
  seats_used: 280,
  paid_until: '2027-01-19',
  pending_orders: 1,
  orders: [
    order(),
    order({
      id: '00000000-0000-4000-8000-0000000000a2',
      status: SeatOrderStatus.PAID,
      method: PlatformPaymentMethod.OFFLINE_BANK,
    }),
  ],
};

export const Populated: Story = { args: { detail } };
export const Empty: Story = {
  args: {
    detail: { ...detail, seats_entitled: 0, paid_until: null, pending_orders: 0, orders: [] },
  },
};
export const IdleSchool: Story = {
  args: {
    detail: {
      ...detail,
      status: 'SUSPENDED',
      status_reason: 'IDLE',
      seats_entitled: 0,
      orders: [],
    },
  },
};
export const Loading: Story = { args: { loading: true } };
export const ErrorState: Story = { args: { error: true } };
export const Phone: Story = {
  ...Populated,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
