import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
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
});
