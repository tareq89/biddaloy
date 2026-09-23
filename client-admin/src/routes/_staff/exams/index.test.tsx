import {
  academicYearFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [19.6.1] Exams list — same `ListShell`-against-the-real-route-tree
 * pattern `classes/index.test.tsx` uses. */
describe('/exams', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists exams with name/kind/status columns', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const exam = examFactory({
      id: 'exam-1',
      name: 'Half Yearly 2026',
      kind: 'TERM',
      status: 'DRAFT',
      academic_year: year,
      academic_year_id: year.id,
    });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Exams' });
    await screen.findByText('Half Yearly 2026');
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Term')).toBeTruthy();
    expect(within(row).getByText('Draft')).toBeTruthy();
  });

  it('surfaces a validation error creating an exam without a class/year', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Add exam' }));
    await user.type(await screen.findByLabelText('Name'), 'Model Test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Academic year and class are required.');
  });
});
