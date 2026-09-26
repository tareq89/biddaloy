import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [25.6] Seat plans list — same `ListShell`-against-the-real-route-tree
 * pattern `exams/index.test.tsx` uses. */
describe('/exams/seat-plans', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists seat plans with status/count columns', async () => {
    server.use(
      http.get('/api/v1/seat-plans', () =>
        HttpResponse.json([
          {
            id: 'plan-1',
            name: 'Half Yearly Seating',
            status: 'DRAFT',
            seat_order_mode: 'SEQUENTIAL',
            schedule_count: 2,
            room_count: 3,
            student_count: 40,
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/seat-plans'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Seat plans' });
    await screen.findByText('Half Yearly Seating');
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Draft')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText('40')).toBeTruthy();
  });

  it('shows the forbidden message to a role without SEAT_PLAN_MANAGE', async () => {
    server.use(http.get('/api/v1/seat-plans', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/seat-plans'],
      tenantId: 'tenant-1',
      role: 'EXECUTIVE',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate seat plan' })).toBeNull();
  });
});
