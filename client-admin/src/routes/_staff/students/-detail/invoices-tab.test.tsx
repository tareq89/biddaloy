import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** The Invoices tab, mounted through the real `/students/$studentId` route. */
describe('students/-detail/invoices-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a long-form due date and view/print row actions', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({
          data: [
            {
              id: 'inv-1',
              invoice_number: 'INV-2026-0001',
              total_amount: '500.00',
              status: 'ISSUED',
              due_date: '2026-03-12',
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=invoices'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('region', { name: 'Invoices' });
    expect(within(table).getByText('INV-2026-0001')).toBeTruthy();
    expect(within(table).queryByText('2026-03-12')).toBeNull();
    expect(within(table).getByRole('link', { name: 'View invoice' }).getAttribute('href')).toBe(
      '/invoices/inv-1',
    );
    expect(within(table).getByRole('button', { name: 'Print' })).toBeTruthy();
  });
});
