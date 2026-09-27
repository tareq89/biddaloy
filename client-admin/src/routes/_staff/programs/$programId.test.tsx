/**
 * [34.4.1] Program detail. Same manual single-route-tree bypass as
 * `index.test.tsx` — `route-permissions.ts` (34.4.2's territory) has no
 * entry for this route yet, so going through the real `routeTree.gen.ts`
 * would hit `_staff.tsx`'s fail-closed `AccessDeniedState` for every role.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { Route as ProgramDetailRoute } from './$programId';

function buildRouteTree() {
  const rootRoute = createRootRoute();
  ProgramDetailRoute.update({
    id: '/$programId',
    path: '/$programId',
    getParentRoute: () => rootRoute,
  } as never);
  return rootRoute.addChildren([ProgramDetailRoute]);
}

function program(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-1',
    name: 'Reading Club',
    description: null,
    is_active: true,
    show_on_report_card: false,
    milestone_count: 1,
    active_enrollment_count: 1,
    milestones: [
      { id: 'm-1', name: 'Read 5 books', description: null, sequence: 1, achievement_count: 0 },
    ],
    ...overrides,
  };
}

function enrollmentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'enr-1',
    status: 'ACTIVE',
    started_on: '2026-01-01',
    ended_on: null,
    student: {
      id: 'student-1',
      full_name: 'Anika Rahman',
      roll_number: '12',
      class_name: 'Six',
      section_name: 'A',
    },
    achieved_count: 0,
    milestone_total: 1,
    ...overrides,
  };
}

describe('/programs/$programId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('switches between the Milestones and Students tabs', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(program())),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([enrollmentRow()])),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Read 5 books');
    await user.click(screen.getByRole('tab', { name: 'Students' }));
    await screen.findByText('Anika Rahman');
  });

  it('adding a milestone calls the add-milestone endpoint', async () => {
    const user = userEvent.setup();
    let addCalled = false;
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(program())),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
      http.post('/api/v1/programs/:id/milestones', async ({ request }) => {
        addCalled = true;
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({ id: 'm-2', name: body.name, description: null, sequence: 2 });
      }),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Read 5 books');
    await user.type(screen.getByPlaceholderText('Add milestone'), 'Read 10 books');
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));

    await waitFor(() => expect(addCalled).toBe(true));
  });

  it('reordering a milestone calls the reorder endpoint', async () => {
    const user = userEvent.setup();
    let reorderedIds: string[] = [];
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(
          program({
            milestones: [
              { id: 'm-1', name: 'First', description: null, sequence: 1, achievement_count: 0 },
              { id: 'm-2', name: 'Second', description: null, sequence: 2, achievement_count: 0 },
            ],
          }),
        ),
      ),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
      http.put('/api/v1/programs/:id/milestones/order', async ({ request }) => {
        const body = (await request.json()) as { milestone_ids: string[] };
        reorderedIds = body.milestone_ids;
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('First');
    await user.click(screen.getAllByRole('button', { name: 'Move milestone down' })[0]!);

    await waitFor(() => expect(reorderedIds).toEqual(['m-2', 'm-1']));
  });

  it('removing a milestone shows the achievement count before confirming', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(
          program({
            milestones: [
              {
                id: 'm-1',
                name: 'Read 5 books',
                description: null,
                sequence: 1,
                achievement_count: 3,
              },
            ],
          }),
        ),
      ),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Read 5 books');
    await user.click(screen.getByRole('button', { name: 'Remove milestone' }));

    await screen.findByText(/3 recorded achievements/);
  });

  it('hides the progress column when the program has no milestones', async () => {
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(program({ milestone_count: 0, milestones: [] })),
      ),
      http.get('/api/v1/programs/:id/enrollments', () =>
        HttpResponse.json([enrollmentRow({ milestone_total: 0 })]),
      ),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Students' }));

    await screen.findByText('Anika Rahman');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('offers to mark complete once a student reaches 100%', async () => {
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(program())),
      http.get('/api/v1/programs/:id/enrollments', () =>
        HttpResponse.json([enrollmentRow({ achieved_count: 1, milestone_total: 1 })]),
      ),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Students' }));
    await screen.findByText('Anika Rahman');

    const row = screen.getByText('Anika Rahman').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Mark complete' }));
    await screen.findByRole('menuitem', {
      name: 'All milestones achieved — mark complete?',
    });
  });
});
