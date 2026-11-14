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

import { PackageDialog } from './package-dialog';
import { PackageListView } from './package-list-view';

const pkgs = [
  {
    id: '1',
    name: '5,000 SMS',
    smsCount: 5000,
    validityDays: 180,
    pricePaisa: '150000',
    priceTaka: '1500.00',
    active: true,
  },
  {
    id: '2',
    name: '1,000 SMS',
    smsCount: 1000,
    validityDays: 90,
    pricePaisa: '35000',
    priceTaka: '350.00',
    active: false,
  },
];

const noop = () => undefined;
const list = (over: Partial<React.ComponentProps<typeof PackageListView>> = {}) => (
  <PackageListView
    packages={pkgs}
    onRetry={noop}
    onNew={noop}
    onRecordStock={noop}
    onEdit={noop}
    onToggle={noop}
    {...over}
  />
);

function Dialog({ edit = false }: { edit?: boolean }) {
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <PackageDialog open onOpenChange={noop} pkg={edit ? pkgs[0] : undefined} />,
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

/** #3884 SMS packages: list states and the new/edit dialog at 390 and 1440 px. */
const meta: Meta = { title: 'Cockpit/Money/SMS packages' };
export default meta;
type Story = StoryObj;

const phone = { viewport: { defaultViewport: 'mobile1' } };
const desktop = { viewport: { defaultViewport: 'desktop1440' } };

export const PopulatedPhone: Story = { render: () => list(), parameters: phone };
export const PopulatedDesktop: Story = { render: () => list(), parameters: desktop };
export const LoadingPhone: Story = {
  render: () => list({ loading: true, packages: [] }),
  parameters: phone,
};
export const LoadingDesktop: Story = {
  render: () => list({ loading: true, packages: [] }),
  parameters: desktop,
};
export const EmptyPhone: Story = { render: () => list({ packages: [] }), parameters: phone };
export const EmptyDesktop: Story = { render: () => list({ packages: [] }), parameters: desktop };
export const ErrorPhone: Story = {
  render: () => list({ error: true, packages: [] }),
  parameters: phone,
};
export const ErrorDesktop: Story = {
  render: () => list({ error: true, packages: [] }),
  parameters: desktop,
};
export const NewDialogPhone: Story = { render: () => <Dialog />, parameters: phone };
export const NewDialogDesktop: Story = { render: () => <Dialog />, parameters: desktop };
export const EditDialogDesktop: Story = {
  render: () => <Dialog edit />,
  parameters: {
    ...desktop,
    msw: {
      handlers: [http.patch('*/platform/sms-packages/:id', () => HttpResponse.json(pkgs[0]))],
    },
  },
};
