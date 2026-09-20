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
import type { ComponentProps } from 'react';

import { UpcomingCalendarCard } from './upcoming-calendar-card';

// `UpcomingCalendarCard` renders a real `Link` (target differs per
// surface) which needs a router context in scope — Storybook's preview
// has no global `RouterProvider` decorator, so each story mounts its own
// minimal in-memory router, same shape `render-with-router.tsx` builds
// for tests.
function CardWithRouter(props: ComponentProps<typeof UpcomingCalendarCard>) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <UpcomingCalendarCard {...props} />,
  });
  const calendarRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/calendar',
    component: () => <p data-testid="calendar-page" />,
  });
  const portalCalendarRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/portal/calendar',
    component: () => <p data-testid="portal-calendar-page" />,
  });
  const routeTree = rootRoute.addChildren([indexRoute, calendarRoute, portalCalendarRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return <RouterProvider router={router} />;
}

// Staff variant self-gates on `Permission.CALENDAR_READ` when
// `requirePermission` is set — every story here needs an active role that
// holds it. The no-permission case (renders nothing) is covered by
// `upcoming-calendar-card.test.tsx` instead, since there's nothing to show
// in Storybook.
setActiveRole('ADMIN');

function eventsResponse(events: Array<Record<string, unknown>>) {
  return HttpResponse.json({ data: events, total: events.length, page: 1, limit: 6, totalPages: 1 });
}

function makeEvent(overrides: Record<string, unknown>) {
  return {
    id: 'evt-1',
    academic_year_id: 'ay-1',
    type: 'EVENT',
    name: 'Event',
    description: null,
    start_date: '2026-09-25',
    end_date: '2026-09-25',
    start_time: null,
    end_time: null,
    counts_as_working_day: true,
    audience: 'ALL',
    class_ids: [],
    is_locked: false,
    published: true,
    ...overrides,
  };
}

const meta: Meta<typeof CardWithRouter> = {
  component: CardWithRouter,
};

export default meta;
type Story = StoryObj<typeof CardWithRouter>;

/** Staff dashboard variant — links to `/calendar`, gated on CALENDAR_READ. */
export const StaffDashboard: Story = {
  args: { calendarPath: '/calendar', requirePermission: true },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/events', () =>
          eventsResponse([
            makeEvent({ id: 'evt-1', type: 'HOLIDAY', name: 'Victory Day', start_date: '2026-09-30' }),
            makeEvent({ id: 'evt-2', type: 'EXAM', name: 'Midterm', start_date: '2026-10-02' }),
            makeEvent({ id: 'evt-3', type: 'EVENT', name: 'Sports day', start_date: '2026-10-05' }),
          ]),
        ),
      ],
    },
  },
};

/** Portal home variant — links to `/portal/calendar`, no permission prop. */
export const PortalHome: Story = {
  args: { calendarPath: '/portal/calendar' },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/events', () =>
          eventsResponse([
            makeEvent({ id: 'evt-1', type: 'MEETING', name: 'Parent-teacher meeting', start_date: '2026-09-28' }),
            makeEvent({ id: 'evt-2', type: 'DEADLINE', name: 'Fee due', start_date: '2026-10-01' }),
          ]),
        ),
      ],
    },
  },
};

export const Empty: Story = {
  args: { calendarPath: '/calendar', requirePermission: true },
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/calendar/events', () => eventsResponse([]))],
    },
  },
};
