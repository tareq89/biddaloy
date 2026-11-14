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

import { PlanChangeDialog } from './plan-change-dialog';
import { PlanDialog } from './plan-dialog';
import { PlanListView } from './plan-list-view';

const plans = [
  { id: '1', name: 'Standard', unit_price_paisa: 1000, active: true, is_default: true },
  { id: '2', name: 'Premium', unit_price_paisa: 2500, active: true, is_default: false },
  { id: '3', name: 'Old plan', unit_price_paisa: 500, active: false, is_default: false },
];

const noop = () => undefined;
const list = (over: Partial<React.ComponentProps<typeof PlanListView>> = {}) => (
  <PlanListView plans={plans} onRetry={noop} onNew={noop} onEdit={noop} onToggle={noop} {...over} />
);

function Host({ children }: { children: React.ReactNode }) {
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => children,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <ApprovalModalHostProvider>
      <RouterProvider router={router} />
    </ApprovalModalHostProvider>
  );
}

/** #3886 Plans: list states, new/edit dialog and the change-plan dialog at 390 and 1440 px. */
const meta: Meta = { title: 'Cockpit/Money/Plans' };
export default meta;
type Story = StoryObj;

const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };
const plansApi = {
  msw: { handlers: [http.get('*/platform/plans', () => HttpResponse.json(plans))] },
};

export const PopulatedPhone: Story = { render: () => list(), parameters: phone };
export const PopulatedDesktop: Story = { render: () => list(), parameters: desktop };
export const LoadingPhone: Story = {
  render: () => list({ loading: true, plans: [] }),
  parameters: phone,
};
export const LoadingDesktop: Story = {
  render: () => list({ loading: true, plans: [] }),
  parameters: desktop,
};
export const EmptyPhone: Story = { render: () => list({ plans: [] }), parameters: phone };
export const EmptyDesktop: Story = { render: () => list({ plans: [] }), parameters: desktop };
export const ErrorPhone: Story = {
  render: () => list({ error: true, plans: [] }),
  parameters: phone,
};
export const ErrorDesktop: Story = {
  render: () => list({ error: true, plans: [] }),
  parameters: desktop,
};
export const NewDialogPhone: Story = {
  render: () => (
    <Host>
      <PlanDialog open onOpenChange={noop} />
    </Host>
  ),
  parameters: phone,
};
export const EditDialogDesktop: Story = {
  render: () => (
    <Host>
      <PlanDialog open onOpenChange={noop} plan={plans[1]} />
    </Host>
  ),
  parameters: desktop,
};
const change = (
  <Host>
    <PlanChangeDialog
      schoolId="9"
      schoolName="Green Valley School"
      currentPlanId="1"
      open
      onOpenChange={noop}
    />
  </Host>
);
export const ChangeDialogPhone: Story = {
  render: () => change,
  parameters: { ...phone, ...plansApi },
};
export const ChangeDialogDesktop: Story = {
  render: () => change,
  parameters: { ...desktop, ...plansApi },
};
