import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { UpcomingCalendarCard, type UpcomingCalendarCardProps } from './upcoming-calendar-card';

// `UpcomingCalendarCard` renders a real `Link` (target differs per
// surface), which needs a live router context — a bare
// `renderWithProviders` throws (`useLinkPropsFor` needs the router).
// Same minimal-route-tree pattern `staff-user-menu.test.tsx` uses.
function buildRouteTree(props: UpcomingCalendarCardProps) {
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
  return rootRoute.addChildren([indexRoute, calendarRoute, portalCalendarRoute]);
}

function renderCard(
  props: UpcomingCalendarCardProps,
  options: Parameters<typeof renderWithRouter>[1] = {},
) {
  return renderWithRouter(buildRouteTree(props), {
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
    ...options,
  });
}

function eventsResponse(events: Array<Record<string, unknown>>) {
  return HttpResponse.json({
    data: events,
    total: events.length,
    page: 1,
    limit: 6,
    totalPages: 1,
  });
}

function makeEvent(overrides: Record<string, unknown>) {
  return {
    id: overrides.id ?? 'evt-1',
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

describe('UpcomingCalendarCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the holiday line only when a HOLIDAY event is in range', async () => {
    server.use(
      http.get('/api/v1/calendar/events', () =>
        eventsResponse([
          makeEvent({ id: 'evt-1', type: 'EVENT', name: 'Sports day', start_date: '2026-09-20' }),
        ]),
      ),
    );

    renderCard({ calendarPath: '/calendar' });

    await screen.findByText('Sports day');
    expect(screen.queryByText(/Next holiday/)).toBeNull();
  });

  it('shows the next holiday line when a HOLIDAY event is in range', async () => {
    server.use(
      http.get('/api/v1/calendar/events', () =>
        eventsResponse([
          makeEvent({
            id: 'evt-holiday',
            type: 'HOLIDAY',
            name: 'Victory Day',
            start_date: '2026-09-20',
          }),
        ]),
      ),
    );

    renderCard({ calendarPath: '/calendar' });

    expect(await screen.findByText(/Next holiday: Victory Day/)).toBeTruthy();
  });

  it('caps the events list at five', async () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      makeEvent({
        id: `evt-${index}`,
        name: `Event ${index}`,
        start_date: `2026-09-2${index}`,
      }),
    );
    server.use(http.get('/api/v1/calendar/events', () => eventsResponse(events)));

    renderCard({ calendarPath: '/calendar' });

    await screen.findByText('Event 0');
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('links to /calendar on the staff surface', async () => {
    server.use(
      http.get('/api/v1/calendar/events', () =>
        eventsResponse([makeEvent({ id: 'evt-1', name: 'Sports day' })]),
      ),
    );

    renderCard({ calendarPath: '/calendar' });

    const link = await screen.findByRole('link', { name: /Sports day/ });
    expect(link.getAttribute('href')).toBe('/calendar');
  });

  it('links to /portal/calendar on the portal surface', async () => {
    server.use(
      http.get('/api/v1/calendar/events', () =>
        eventsResponse([makeEvent({ id: 'evt-1', name: 'Sports day' })]),
      ),
    );

    renderCard({ calendarPath: '/portal/calendar' }, { role: 'PARENT' });

    const link = await screen.findByRole('link', { name: /Sports day/ });
    expect(link.getAttribute('href')).toBe('/portal/calendar');
  });

  it('renders an event whose `published` field is absent (the portal family DTO shape)', async () => {
    // FamilyCalendarEventDto (what the portal surface actually receives)
    // has no `published` field at all — `event.published` is `undefined`
    // there. Filtering on truthiness alone would drop every portal event.
    const { published: _published, ...eventWithoutPublished } = makeEvent({
      id: 'evt-portal',
      name: 'Portal Event',
    });
    void _published;
    server.use(http.get('/api/v1/calendar/events', () => eventsResponse([eventWithoutPublished])));

    renderCard({ calendarPath: '/portal/calendar' }, { role: 'PARENT' });

    expect(await screen.findByText('Portal Event')).toBeTruthy();
  });

  it('excludes an event explicitly marked published: false', async () => {
    server.use(
      http.get('/api/v1/calendar/events', () =>
        eventsResponse([makeEvent({ id: 'evt-draft', name: 'Draft Event', published: false })]),
      ),
    );

    renderCard({ calendarPath: '/calendar' });

    expect(await screen.findByText('Nothing scheduled in the next 60 days.')).toBeTruthy();
    expect(screen.queryByText('Draft Event')).toBeNull();
  });

  it('shows the empty state when nothing is scheduled', async () => {
    server.use(http.get('/api/v1/calendar/events', () => eventsResponse([])));

    renderCard({ calendarPath: '/calendar' });

    expect(await screen.findByText('Nothing scheduled in the next 60 days.')).toBeTruthy();
  });

  it('renders nothing for a staff role without CALENDAR_READ', async () => {
    const { container } = renderCard(
      { calendarPath: '/calendar', requirePermission: true },
      { role: 'GUARDIAN' },
    );

    await Promise.resolve();
    expect(container.innerHTML).toBe('');
  });
});
