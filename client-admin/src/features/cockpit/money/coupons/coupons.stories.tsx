import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { CouponDialog } from './coupon-dialog';
import { CouponListView } from './coupon-list-view';
import { CouponUsage } from './coupon-usage';

const base = {
  discount_kind: 'PERCENT' as const,
  percent: 50,
  fixed_paisa: null,
  max_months: 3,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: 'ALL' as const,
  max_uses: 5,
  uses_count: 2,
  per_school_max: 1,
  starts_at: '2029-01-01T00:00:00.000Z',
  ends_at: '2030-12-31T00:00:00.000Z',
  active: true,
  created_at: '2029-01-01T00:00:00.000Z',
};
const coupons = [
  { ...base, id: '1', code: 'SPRING50' },
  {
    ...base,
    id: '2',
    code: 'FLAT100',
    discount_kind: 'FIXED' as const,
    percent: null,
    fixed_paisa: 10000,
    max_months: null,
  },
  { ...base, id: '3', code: 'OLDONE', active: false, max_uses: null },
];

const noop = () => undefined;
const list = (over: Partial<React.ComponentProps<typeof CouponListView>> = {}) => (
  <CouponListView
    coupons={coupons}
    onRetry={noop}
    onNew={noop}
    onEdit={noop}
    onUsage={noop}
    onToggle={noop}
    {...over}
  />
);

/** #3887 Coupons: list states, new/edit dialog and usage at 390 and 1440 px. */
const meta: Meta = { title: 'Cockpit/Money/Coupons' };
export default meta;
type Story = StoryObj;

const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const api = {
  msw: {
    handlers: [
      http.get('*/platform/coupons/:id/usage', () =>
        HttpResponse.json({
          uses: 5,
          totalDiscountPaisa: '150000',
          schools: {
            items: [
              { schoolId: 'a', schoolName: 'Rose Valley School', uses: 3, discountPaisa: '90000' },
              { schoolId: 'b', schoolName: 'Green Hill School', uses: 2, discountPaisa: '60000' },
            ],
            nextCursor: null,
          },
        }),
      ),
    ],
  },
};

export const PopulatedPhone: Story = { render: () => list(), parameters: phone };
export const PopulatedDesktop: Story = { render: () => list(), parameters: desktop };
export const LoadingPhone: Story = {
  render: () => list({ loading: true, coupons: [] }),
  parameters: phone,
};
export const LoadingDesktop: Story = {
  render: () => list({ loading: true, coupons: [] }),
  parameters: desktop,
};
export const EmptyPhone: Story = { render: () => list({ coupons: [] }), parameters: phone };
export const EmptyDesktop: Story = { render: () => list({ coupons: [] }), parameters: desktop };
export const ErrorPhone: Story = {
  render: () => list({ error: true, coupons: [] }),
  parameters: phone,
};
export const ErrorDesktop: Story = {
  render: () => list({ error: true, coupons: [] }),
  parameters: desktop,
};
export const NewDialogPhone: Story = {
  render: () => (
    <ApprovalModalHostProvider>
      <CouponDialog open onOpenChange={noop} onOpenApprovals={noop} />
    </ApprovalModalHostProvider>
  ),
  parameters: phone,
};
export const EditDialogDesktop: Story = {
  render: () => (
    <ApprovalModalHostProvider>
      <CouponDialog open onOpenChange={noop} onOpenApprovals={noop} coupon={coupons[0]} />
    </ApprovalModalHostProvider>
  ),
  parameters: desktop,
};
const usage = <CouponUsage coupon={coupons[0]} onOpenChange={noop} />;
export const UsagePhone: Story = { render: () => usage, parameters: { ...phone, ...api } };
export const UsageDesktop: Story = { render: () => usage, parameters: { ...desktop, ...api } };
