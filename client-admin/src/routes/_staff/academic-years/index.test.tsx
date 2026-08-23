import {
  academicYearFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  type AcademicYear,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.1]'s list page — real `ListShell`/`DataTable` against the real
 * route tree, same reasoning `students/index.test.tsx`'s own header
 * comment. Every case carries a `role` since `/academic-years` sits
 * under `_staff`.
 */
describe('/academic-years', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists academic years with a Current badge on the one marked current', async () => {
    const current = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const other = academicYearFactory({ id: 'year-2', name: '2025-2026', is_current: false });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [current, other], total: 2, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Academic Years' });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Current')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Not current')).toBeTruthy();
  });

  it('gates Add/Edit/Delete/Set current by permission — ADMIN sees them, TEACHER does not', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { unmount } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.getByRole('button', { name: 'Add year' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set as current' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    unmount();

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Academic Years' });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Add year' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('creating a year shows up in the list once the dialog is submitted', async () => {
    let years: AcademicYear[] = [];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: years, total: years.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/academic-years', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        const created = academicYearFactory({ id: 'new-year', name: body.name });
        years = [...years, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add year' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), '2027-2028');
    await user.type(dialog.getByLabelText('Start date'), '2027-01-01');
    await user.type(dialog.getByLabelText('End date'), '2027-12-31');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
  });

  it('the date-range validation error names both dates, per the issue AC', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add year' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Bad Year');
    await user.type(dialog.getByLabelText('Start date'), '2027-12-31');
    await user.type(dialog.getByLabelText('End date'), '2027-01-01');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await dialog.findByText('End date must be after the start date')).toBeTruthy();
  });

  it("Set as current explicitly warns it unsets every other year — this issue's own AC", async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2025-2026', is_current: false });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/academic-years/:id/set-current', ({ params }) =>
        HttpResponse.json(academicYearFactory({ id: params.id as string, is_current: true })),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set as current' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/unsets every other academic year/i)).toBeTruthy();

    await user.click(dialog.getByRole('button', { name: 'Set as current' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deleting a year removes it from the list', async () => {
    let years: AcademicYear[] = [academicYearFactory({ id: 'year-1', name: 'Delete Me' })];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: years, total: years.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.delete('/api/v1/academic-years/:id', () => {
        years = [];
        return new HttpResponse(null, { status: 200 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('No academic years found')).toBeTruthy());
  });

  it('is axe clean', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [academicYearFactory({ id: 'year-1' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      // Test-local, not the shared default handler's stats — this test
      // waits for its own known value, not a value it happens to share
      // with whatever the default handler currently returns.
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 3, students_count: 17, fee_structures_count: 5 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Edit' });
    // Waits for the per-row stats cells to settle too — otherwise their
    // fetch resolves after this test's own assertions, which React logs
    // as an unwrapped `act()` update against a since-finished test.
    await screen.findByText('17');
    await expect(container).toHaveNoViolations();
  });
});
