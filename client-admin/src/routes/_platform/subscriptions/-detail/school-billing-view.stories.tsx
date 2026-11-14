import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import type { PlatformBundleOrder, SeatOrderDto } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchoolBillingView, type SchoolBillingDetail } from './school-billing-view';

/** Epic 49 W4: one school's seats and orders. States: loading, error, empty, populated, idle. */
const meta: Meta<typeof SchoolBillingView> = {
  component: SchoolBillingView,
  args: {
    loading: false,
    onRetry: () => {},
    onGrant: () => {},
    onRecordPayment: () => {},
    onRevive: () => {},
    onRefundSeat: () => {},
    onRefundPackage: () => {},
    onChangePlan: () => {},
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
  receipt_number: null,
  paid_at: null,
  created_at: '2026-10-20T04:00:00.000Z',
  ...over,
});

const pkg = (over: Partial<PlatformBundleOrder> = {}): PlatformBundleOrder => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  status: 'ACTIVE',
  bundle_name: 'Starter',
  sms_count: 5000,
  amount_paisa: 150_000,
  receipt_number: 'SMR-2026-000009',
  paid_at: '2026-11-12T04:00:00.000Z',
  refunded_at: null,
  units_bought: 5000,
  units_used: 0,
  refundable: true,
  ...over,
});

const detail: SchoolBillingDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ananta School',
  status: 'ACTIVE',
  status_reason: null,
  deleted: false,
  seats_entitled: 300,
  seats_used: 280,
  paid_until: '2027-01-19',
  pending_orders: 1,
  plan: { id: 'plan-1', name: 'Standard', unit_price_paisa: 1000 },
  orders: [
    order(),
    order({
      id: '00000000-0000-4000-8000-0000000000a2',
      status: SeatOrderStatus.PAID,
      method: PlatformPaymentMethod.OFFLINE_BANK,
    }),
  ],
};

const refundableDetail: SchoolBillingDetail = {
  ...detail,
  orders: [
    ...detail.orders,
    order({
      id: '00000000-0000-4000-8000-0000000000a3',
      status: SeatOrderStatus.REFUNDED,
      method: PlatformPaymentMethod.OFFLINE_BANK,
    }),
    order({
      id: '00000000-0000-4000-8000-0000000000a4',
      status: SeatOrderStatus.PAID,
      amount_paisa: 0,
      method: PlatformPaymentMethod.OFFLINE_BANK,
    }),
  ],
  bundle_orders: [
    pkg(),
    pkg({
      id: '00000000-0000-4000-8000-0000000000b2',
      status: 'USED_UP',
      refundable: false,
      units_used: 120,
    }),
    pkg({
      id: '00000000-0000-4000-8000-0000000000b3',
      status: 'REFUNDED',
      refundable: false,
      refunded_at: '2026-11-13T04:00:00.000Z',
    }),
  ],
};

export const Populated: Story = { args: { detail } };
/** #3888 seat and package orders: Refund on paid rows, a refunded row, a free one, a used package. */
export const Refundable: Story = {
  args: { detail: refundableDetail },
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};
export const RefundablePhone: Story = {
  args: { detail: refundableDetail },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const NoPackages: Story = { args: { detail: { ...detail, bundle_orders: [] } } };
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
