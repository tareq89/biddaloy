import '@biddaloy/ui/test';

import { mySectionsQueryOptions } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { AttendancePendingCard } from './attendance-pending-card';

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: AttendancePendingCard,
  });
  const attendanceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/attendance',
    component: () => <p data-testid="attendance-page" />,
  });
  return rootRoute.addChildren([indexRoute, attendanceRoute]);
}

function renderCard(options: Parameters<typeof renderWithRouter>[1] = {}) {
  return renderWithRouter(buildRouteTree(), {
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
    ...options,
  });
}

function makeSection(overrides: Record<string, unknown>) {
  return {
    section_id: 's-1',
    section_name: 'A',
    class_id: 'c-1',
    class_name: 'Class 1',
    student_count: 30,
    class_teacher_name: null,
    is_working_day: true,
    today: null,
    ...overrides,
  };
}

const finalized = {
  state: 'FINALIZED',
  present: 28,
  absent: 2,
  late: 0,
  leave: 0,
  unmarked: 0,
  marked_at: null,
};

function useSections(sections: Array<Record<string, unknown>>) {
  server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(sections)));
}

describe('AttendancePendingCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the pending count; draft and unmarked count, empty sections do not', async () => {
    useSections([
      makeSection({ section_id: 's-1', today: finalized }),
      makeSection({ section_id: 's-2', today: { ...finalized, state: 'DRAFT' } }),
      makeSection({ section_id: 's-3', today: null }),
      makeSection({ section_id: 's-4', student_count: 0 }),
    ]);

    renderCard();

    // Numbers go through `formatNumber` (region digits), so match the shape.
    expect(await screen.findByText(/of .+ sections pending/)).toBeTruthy();
    expect(screen.getByText(/^.+ of .+ sections pending$/).textContent).toMatch(/(2|২) of (3|৩)/);
  });

  it('links to /attendance with status=pending and a clear name', async () => {
    useSections([makeSection({})]);

    renderCard();

    const link = await screen.findByRole('link', { name: 'See pending sections' });
    expect(link.getAttribute('href')).toBe('/attendance?status=pending');
  });

  it('shows all-done with no link when every section is finalized', async () => {
    useSections([makeSection({ today: finalized })]);

    renderCard();

    expect(await screen.findByText('All sections are marked')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the holiday line when no section has a working day', async () => {
    useSections([makeSection({ is_working_day: false })]);

    renderCard();

    expect(await screen.findByText('School is closed today')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing and fetches nothing without ATTENDANCE_READ', async () => {
    let requests = 0;
    server.use(
      http.get('/api/v1/attendance/my-sections', () => {
        requests += 1;
        return HttpResponse.json([]);
      }),
    );

    const { container, queryClient } = renderCard({ role: 'GUARDIAN' });

    // The card mounted (its query exists) but the query never left idle.
    const key = mySectionsQueryOptions().queryKey;
    await waitFor(() => expect(queryClient.getQueryState(key)).toBeDefined());
    expect(queryClient.getQueryState(key)!.fetchStatus).toBe('idle');
    expect(requests).toBe(0);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for an empty list', async () => {
    useSections([]);

    const { container, queryClient } = renderCard();

    await waitFor(() =>
      expect(queryClient.getQueryState(mySectionsQueryOptions().queryKey)?.status).toBe('success'),
    );
    expect(screen.queryByText("Today's attendance")).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows an error with Retry that refetches', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderCard();
    const user = userEvent.setup();

    await screen.findByText('Could not load your sections.', undefined, { timeout: 8000 });

    useSections([makeSection({})]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/of .+ sections pending/)).toBeTruthy();
  });
});
