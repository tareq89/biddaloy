import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    await screen.findByRole('heading', { name: 'Class promotion' });
    await screen.findByText('Class 6 → Class 7');
    await screen.findByText('Class 6 → Graduate');

    const rows = screen.getAllByRole('row');
    const draftRow = rows[1] as HTMLElement;
    expect(within(draftRow).getByText('Next academic year 2027-2028')).toBeTruthy();
    // The row's only link is the eye action (no underlined name link).
    expect(within(draftRow).getByText('Draft')).toBeTruthy();
    expect(within(draftRow).getByText('Block')).toBeTruthy();
    expect(within(draftRow).getByText('৩')).toBeTruthy();
    expect(within(draftRow).getByText('—')).toBeTruthy();
    const view = within(draftRow).getByRole('link', { name: 'View' });
    expect(view.getAttribute('href')).toBe('/promotions/run-draft');
    expect(within(draftRow).getAllByRole('link')).toHaveLength(1);

    const committedRow = rows[2] as HTMLElement;
    expect(within(committedRow).getByText('Finalised')).toBeTruthy();
    expect(within(committedRow).getByText('Snake')).toBeTruthy();
    // A finalised run shows a formatted date, never the ISO string.
    expect(within(committedRow).queryByText(/2027-01-02T/)).toBeNull();
    expect(committedRow.textContent).not.toContain('—');

    // Footer total (2 runs), in whichever numerals the region config renders.
    const count = document.querySelector('[data-slot="table-count"]');
    expect(count?.textContent).toMatch(/[2২]/);
    // The subtitle sits under the title and the header has one primary button.
    expect(
      screen.getByText('Move students up to the next class based on their results.'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New promotion list' })).toHaveLength(1);
  });

  it('shows a dash, never the id, for a class or year that is not in the lookups', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/promotions', () =>
        HttpResponse.json([
          {
            id: 'run-orphan',
            tenant_id: 'tenant-1',
            source_class_id: 'class-ghost',
            source_academic_year_id: 'year-ghost',
            target_academic_year_id: 'year-ghost-2',
            target_class_id: 'class-ghost-2',
            exam_ids: [],
            algorithm: 'BLOCK',
            status: 'DRAFT',
            refreshed_at: '2027-01-01T00:00:00.000Z',
            committed_at: null,
            committed_by_user_id: null,
            approved_by_user_id: null,
            override_count: 0,
            created_by_user_id: 'user-1',
            created_at: '2027-01-01T00:00:00.000Z',
            updated_at: '2027-01-01T00:00:00.000Z',
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

    const link = await screen.findByRole('link', { name: 'View' });
    const row = link.closest('tr') as HTMLElement;
    await within(row).findByText('— → —');
    expect(row.textContent).not.toContain('ghost');
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

    await screen.findByText('No promotion lists yet.');
    // Header primary + the empty state's own action: two buttons, both open the form.
    const buttons = screen.getAllByRole('button', { name: 'New promotion list' });
    expect(buttons).toHaveLength(2);
    await userEvent.setup().click(buttons[1] as HTMLElement);
    await screen.findByRole('heading', { level: 1, name: 'New promotion list' });
  });
});
