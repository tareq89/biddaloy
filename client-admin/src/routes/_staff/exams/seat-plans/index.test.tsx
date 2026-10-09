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
    // Counts use the tenant's numerals.
    expect(within(row).getByText('২')).toBeTruthy();
    expect(within(row).getByText('৩')).toBeTruthy();
    expect(within(row).getByText('৪০')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'View' }).getAttribute('href')).toBe(
      '/exams/seat-plans/plan-1',
    );
    expect(screen.getByText('Seat plans for exams at this school', { exact: false })).toBeTruthy();
  });

  it('shows the empty state with a single add button (the header one)', async () => {
    server.use(http.get('/api/v1/seat-plans', () => HttpResponse.json([])));
    renderWithRouter(routeTree, {
      initialEntries: ['/exams/seat-plans'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByText('No seat plans yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Generate seat plan' })).toHaveLength(1);
  });

  it('pages at 25 by default', async () => {
    const plans = Array.from({ length: 26 }, (_, i) => ({
      id: `plan-${i}`,
      name: `Plan ${String(i).padStart(2, '0')}`,
      status: 'PUBLISHED',
      seat_order_mode: 'SEQUENTIAL',
      schedule_count: 1,
      room_count: 1,
      student_count: 10,
    }));
    server.use(http.get('/api/v1/seat-plans', () => HttpResponse.json(plans)));
    renderWithRouter(routeTree, {
      initialEntries: ['/exams/seat-plans'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Plan 00');
    expect(screen.queryByText('Plan 25')).toBeNull();
    expect(screen.getAllByText('Published')).toHaveLength(25);
  });

  it('?generate=1 opens the full-page form', async () => {
    server.use(
      http.get('/api/v1/seat-plans', () => HttpResponse.json([])),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/routines/rooms', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/exams/seat-plans?generate=1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByRole('heading', { name: 'Generate seat plan' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
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
