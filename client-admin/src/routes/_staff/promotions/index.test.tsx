import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [26.6.1] Promotion runs list — same `ListShell`-against-the-real-route-tree
 * pattern `exams/index.test.tsx` uses. `/promotions` isn't paginated
 * server-side (`ui/src/hooks/promotions.ts`), so these stub the raw array. */
describe('/promotions', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists runs with source/target, year, status, override count and algorithm', async () => {
    const year2026 = academicYearFactory({ id: 'year-2026', name: '2026-2027' });
    const year2027 = academicYearFactory({ id: 'year-2027', name: '2027-2028' });
    const class6 = classFactory({ id: 'class-6', name: 'Class 6', academic_year: year2026 });
    const class7 = classFactory({ id: 'class-7', name: 'Class 7', academic_year: year2027 });

    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [year2026, year2027],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [class6, class7], total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/promotions', () =>
        HttpResponse.json([
          {
            id: 'run-draft',
            tenant_id: 'tenant-1',
            source_class_id: class6.id,
            source_academic_year_id: year2026.id,
            target_academic_year_id: year2027.id,
            target_class_id: class7.id,
            exam_ids: ['exam-1'],
            algorithm: 'BLOCK',
            status: 'DRAFT',
            refreshed_at: '2027-01-01T00:00:00.000Z',
            committed_at: null,
            committed_by_user_id: null,
            approved_by_user_id: null,
            override_count: 3,
            created_by_user_id: 'user-1',
            created_at: '2027-01-01T00:00:00.000Z',
            updated_at: '2027-01-01T00:00:00.000Z',
          },
          {
            id: 'run-committed',
            tenant_id: 'tenant-1',
            source_class_id: class6.id,
            source_academic_year_id: year2026.id,
            target_academic_year_id: year2027.id,
            target_class_id: null,
            exam_ids: ['exam-1'],
            algorithm: 'SNAKE',
            status: 'COMMITTED',
            refreshed_at: '2027-01-01T00:00:00.000Z',
            committed_at: '2027-01-02T00:00:00.000Z',
            committed_by_user_id: 'user-1',
            approved_by_user_id: null,
            override_count: 0,
            created_by_user_id: 'user-1',
            created_at: '2027-01-01T00:00:00.000Z',
            updated_at: '2027-01-02T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Promotions' });
    await screen.findByText('Class 6 → Class 7');
    await screen.findByText('Class 6 → Graduate');

    const rows = screen.getAllByRole('row');
    const draftRow = rows[1] as HTMLElement;
    expect(within(draftRow).getByText('2027-2028')).toBeTruthy();
    expect(within(draftRow).getByText('Draft')).toBeTruthy();
    expect(within(draftRow).getByText('Block (fill sections in order)')).toBeTruthy();
    expect(within(draftRow).getByText('৩')).toBeTruthy();

    const committedRow = rows[2] as HTMLElement;
    expect(within(committedRow).getByText('Committed')).toBeTruthy();
    expect(within(committedRow).getByText('Snake (balance across sections)')).toBeTruthy();
  });

  it('shows an empty state with a link to start a new run', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/promotions', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No promotion runs yet.');
    const link = screen.getByRole('link', { name: 'New promotion run' });
    expect(link.getAttribute('href')).toBe('/promotions/new');
  });
});
