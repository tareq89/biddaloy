import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';

import { RevenueView, type RevenueViewProps } from './revenue-view';
import { VatDialog } from './vat-dialog';

const report = {
  month: '2029-12',
  seat_income_paisa: 1_000_000,
  package_income_paisa: 100_000,
  refunds_paisa: 50_000,
  net_paisa: 1_050_000,
  paying_schools: 7,
  not_renewed: {
    items: [
      {
        school_id: 's1',
        name: 'Rose Valley School',
        paid_until: '2029-11-30',
        days_since_ended: 14,
        plan: 'Standard',
      },
      {
        school_id: 's2',
        name: 'Green Hill School',
        paid_until: '2029-11-15',
        days_since_ended: 29,
        plan: null,
      },
    ],
    next_cursor: null,
  },
};
const noop = () => undefined;

function Host({ children }: { children: React.ReactNode }) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/', component: () => children });
  const school = createRoute({ getParentRoute: () => root, path: '/schools/$schoolId' });
  const router = createRouter({
    routeTree: root.addChildren([page, school]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <ApprovalModalHostProvider>
      <RouterProvider router={router} />
    </ApprovalModalHostProvider>
  );
}

const view = (over: Partial<RevenueViewProps> = {}) => (
  <Host>
    <RevenueView
      month="2029-12"
      onMonthChange={noop}
      report={report}
      onRetry={noop}
      onCsv={noop}
      onVat={noop}
      {...over}
    />
  </Host>
);

/** #3889 Revenue tab: populated, empty, loading, error and the VAT dialog at 390 and 1440 px. */
const meta: Meta = { title: 'Cockpit/Money/Revenue' };
export default meta;
type Story = StoryObj;

const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const empty = { ...report, not_renewed: { items: [], next_cursor: null } };
const vatApi = {
  msw: {
    handlers: [
      http.get('*/platform/money/vat', () =>
        HttpResponse.json({ enabled: true, rate_percent: 13, label: 'VAT', registration: null }),
      ),
    ],
  },
};

export const PopulatedPhone: Story = { render: () => view(), parameters: phone };
export const PopulatedDesktop: Story = { render: () => view(), parameters: desktop };
export const EmptyPhone: Story = { render: () => view({ report: empty }), parameters: phone };
export const LoadingDesktop: Story = {
  render: () => view({ report: undefined, loading: true }),
  parameters: desktop,
};
export const ErrorPhone: Story = {
  render: () => view({ report: undefined, error: true }),
  parameters: phone,
};
export const VatDialogPhone: Story = {
  render: () => (
    <Host>
      <VatDialog open onOpenChange={noop} />
    </Host>
  ),
  parameters: { ...phone, ...vatApi },
};
