import { ROLE_DEFAULT_LAYOUTS } from '@biddaloy/shared';
import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';

import { DashboardPage } from './dashboard-page';

// Same minimal in-memory router the other client-admin stories mount.
function Page() {
  const root = createRootRoute();
  const dash = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: DashboardPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([dash]),
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  });
  return <RouterProvider router={router} />;
}

setActiveRole('ADMIN');

const calm = {
  critical: 0,
  warning: 0,
  reminder: 0,
  activeTotal: 0,
  top: null,
  updatedAt: null,
  staleMinutes: 0,
};
const handlers = (preferences: unknown = null) => [
  http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences })),
  http.get('/api/v1/attention/summary', () => HttpResponse.json(calm)),
  http.get('/api/v1/calendar/events', () =>
    HttpResponse.json({ data: [], total: 0, page: 1, limit: 6, totalPages: 1 }),
  ),
];

const meta: Meta<typeof Page> = { title: 'Dashboard/DashboardPage', component: Page };
export default meta;
type Story = StoryObj<typeof Page>;

export const DefaultLayout: Story = { parameters: { msw: { handlers: handlers() } } };

export const AllHidden: Story = {
  parameters: {
    msw: {
      handlers: handlers({
        dashboard: {
          ADMIN: { widgets: ROLE_DEFAULT_LAYOUTS.ADMIN.map((key) => ({ key, hidden: true })) },
        },
      }),
    },
  },
};

/** One widget's data failing: its card shows its own error, the rest are fine. */
export const WidgetErroring: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/events', () => HttpResponse.json({}, { status: 500 })),
        ...handlers().slice(0, 2),
      ],
    },
  },
};

export const Phone: Story = {
  parameters: {
    msw: { handlers: handlers() },
    viewport: { defaultViewport: 'mobile1' },
  },
};
