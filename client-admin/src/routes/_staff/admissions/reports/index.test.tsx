import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [39.4.2] Admission reports route. `/admissions/reports` sits under
 * `_staff` and is gated by `STUDENT_LIFECYCLE_MANAGE` (ADMIN + EXECUTIVE),
 * so ACCOUNTANT gets the 403 view.
 */
describe('/admissions/reports', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mockApi() {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/admission/reports/lifecycle', () =>
        HttpResponse.json({
          counts: { admitted: 0, withdrawn: 0, transferred_out: 0, graduated: 0, readmitted: 0 },
          rows: [],
          truncated: false,
        }),
      ),
    );
  }

  it('renders the report for ADMIN', async () => {
    mockApi();
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Admission reports' });
  });

  it('refuses the route for ACCOUNTANT, who lacks STUDENT_LIFECYCLE_MANAGE', async () => {
    mockApi();
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/reports'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Admission reports' })).toBeNull();
  });

  const YEARS = {
    data: [
      { id: 'y-old', name: '2025', is_current: false },
      { id: 'y-now', name: '2026', is_current: true },
    ],
    total: 2,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  function mockFilteredApi(seen: URLSearchParams[]) {
    server.use(
      http.get('/api/v1/academic-years', () => HttpResponse.json(YEARS)),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: 'c1', name: 'Six' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/admission/reports/lifecycle', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          counts: { admitted: 0, withdrawn: 0, transferred_out: 0, graduated: 0, readmitted: 0 },
          rows: [],
          truncated: false,
        });
      }),
    );
  }

  it('opens with the year and class from the URL', async () => {
    const seen: URLSearchParams[] = [];
    mockFilteredApi(seen);
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/reports?academicYearId=y-old&classId=c1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        seen.some((p) => p.get('academic_year_id') === 'y-old' && p.get('class_id') === 'c1'),
      ).toBe(true),
    );
    expect(screen.getByRole('combobox', { name: 'Academic year' }).textContent).toContain('2025');
  });

  it('writes a picked year to the URL and drops the class', async () => {
    mockFilteredApi([]);
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/admissions/reports?academicYearId=y-old&classId=c1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ academicYearId: 'y-now' }),
    );
    expect(router.state.location.search).not.toHaveProperty('classId');
  });
});
