import { SeatOrderStatus } from '@biddaloy/shared';
import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { RefundDialog, type RefundTarget } from './refund-dialog';

const seat: RefundTarget = {
  kind: 'seat',
  id: '00000000-0000-4000-8000-0000000000a2',
  school_id: '00000000-0000-4000-8000-000000000001',
  seats: 50,
  months: 3,
  unit_price_paisa: 1000,
  amount_paisa: 150_000,
  period_start: '2026-11-02',
  period_end: '2027-02-02',
  status: SeatOrderStatus.PAID,
  method: null,
  receipt_number: 'SMR-2026-000001',
  paid_at: '2026-11-02T04:00:00.000Z',
  created_at: '2026-11-02T04:00:00.000Z',
  coupon_code: 'WELCOME',
};
const pkg: RefundTarget = {
  kind: 'package',
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
};

const noop = () => undefined;
const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const refundOk = http.post('*/platform/billing/orders/:id/refund', () =>
  HttpResponse.json({ applied: true, order_id: 'x', gateway_ref: 'ABC123', note: 'n' }),
);

const render = (order: RefundTarget) => (
  <ApprovalModalHostProvider>
    <RefundDialog
      open
      onOpenChange={noop}
      schoolId="s-1"
      schoolName="Green Valley School"
      order={order}
    />
  </ApprovalModalHostProvider>
);

/** #3888 Refund dialog: seat order, package order, free order, used package, at 390 and 1440 px. */
const meta: Meta = {
  title: 'Cockpit/Money/Billing',
  parameters: { msw: { handlers: [refundOk] } },
};
export default meta;
type Story = StoryObj;

export const SeatOrderDesktop: Story = { render: () => render(seat), parameters: desktop };
export const SeatOrderPhone: Story = { render: () => render(seat), parameters: phone };
export const PackageOrderDesktop: Story = { render: () => render(pkg), parameters: desktop };
export const FreeOrder: Story = {
  render: () => render({ ...seat, amount_paisa: 0 }),
};
export const PackageUsed: Story = {
  render: () => render({ ...pkg, refundable: false, units_used: 40 }),
  parameters: phone,
};
