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

import { StockSlot } from './stock-slot';

/** #3885 The slot has no props (D46). Each story mounts a memory router; `?record=1` opens the dialog. */
function Slot({ search = '' }: { search?: string }) {
  const rootRoute = createRootRoute();
  const money = createRoute({
    getParentRoute: () => rootRoute,
    path: '/money',
    component: StockSlot,
    validateSearch: (s: Record<string, unknown>) => ({ record: s.record }),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([money]),
    history: createMemoryHistory({ initialEntries: [`/money${search}`] }),
  });
  return (
    <ApprovalModalHostProvider>
      <RouterProvider router={router} />
    </ApprovalModalHostProvider>
  );
}

const meta: Meta = { title: 'Cockpit/Money/SMS bought' };
export default meta;
type Story = StoryObj;

const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };

export const PopulatedPhone: Story = { render: () => <Slot />, parameters: phone };
export const PopulatedDesktop: Story = { render: () => <Slot />, parameters: desktop };
export const DialogOpenPhone: Story = {
  render: () => <Slot search="?record=1" />,
  parameters: phone,
};
export const DialogOpenDesktop: Story = {
  render: () => <Slot search="?record=1" />,
  parameters: desktop,
};

const empty = http.get('*/platform/sms-stock', () =>
  HttpResponse.json({ items: [], nextCursor: null }),
);
export const EmptyPhone: Story = {
  render: () => <Slot />,
  parameters: { ...phone, msw: { handlers: [empty] } },
};
export const EmptyDesktop: Story = {
  render: () => <Slot />,
  parameters: { ...desktop, msw: { handlers: [empty] } },
};

const failing = http.get('*/platform/sms-stock', () => new HttpResponse(null, { status: 500 }));
export const ErrorPhone: Story = {
  render: () => <Slot />,
  parameters: { ...phone, msw: { handlers: [failing] } },
};
