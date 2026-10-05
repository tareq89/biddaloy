/**
 * [34.4.1] Program detail. Same manual single-route-tree bypass as
 * `index.test.tsx` — `route-permissions.ts` (34.4.2's territory) has no
 * entry for this route yet, so going through the real `routeTree.gen.ts`
 * would hit `_staff.tsx`'s fail-closed `AccessDeniedState` for every role.
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
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
    await user.type(screen.getByLabelText('New milestone name'), 'Read 10 books');
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

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/(3|৩) recorded achievements/)).toBeTruthy();
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
    expect(
      within(row).getByRole('button', { name: 'All milestones achieved — mark complete?' }),
    ).toBeTruthy();
  });

  it('shows the forbidden message on a 403', async () => {
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/programs/p-1'), { status: 403 }),
      ),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText("You don't have permission to view this program");
  });

  it('shows the archived badge and opens the edit dialog', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(program({ is_active: false }))),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Archived');
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit program' }));
    await screen.findByRole('heading', { name: 'Edit program' });
  });

  it('shows the facts, with Record as the only primary and archive/delete in More', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(program({ active_enrollment_count: 0 })),
      ),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(/^(1|১) milestone$/);
    expect(screen.getByText(/^(0|০) students$/)).toBeTruthy();
    expect(screen.getByText('Not shown')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record achievement' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enrol students' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('hides Delete when the program has active enrolments', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () => HttpResponse.json(program())),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(/^(1|১) student$/);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('confirms before deleting and shows the conflict sentence on a 409', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/programs/:id', () =>
        HttpResponse.json(program({ active_enrollment_count: 0 })),
      ),
      http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])),
      http.delete('/api/v1/programs/:id', () =>
        HttpResponse.json(apiErrorBody(409, 'Has enrolments', '/programs/p-1'), { status: 409 }),
      ),
    );

    renderWithRouter(buildRouteTree(), {
      initialEntries: ['/p-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(/^(1|১) milestone$/);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText("Delete this program? This can't be undone.")).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await within(dialog).findByText(
        'This program has enrolled students — archive it instead of deleting.',
      ),
    ).toBeTruthy();
  });
});
