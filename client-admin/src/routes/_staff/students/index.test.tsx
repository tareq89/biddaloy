import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * Covers [8.10.1]'s acceptance criteria against the real route tree — not
 * a hand-built double, the actual `ListShell`/`DataTable` this route
 * wires up, same reasoning as [8.9.1]'s own route test this one replaces.
 *
 * Every case carries staff `role` since [8.9.10]: `/students` sits under
 * the `_staff` layout, and `RequireRole` sends anyone else somewhere else
 * entirely.
 */
describe('/students', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('reads its initial filter state from the URL, not a default', async () => {
    const section = classSectionFactory({ section_name: 'B' });
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students?class_id=class-9'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Class 9'),
    );
  });

  it('a non-numeric page falls back to page 1 instead of crashing', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?page=abc'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('region', { name: 'Students' })).toBeTruthy());
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  it("Collect fees deep-links into Record Payment, pre-filled with that row's student", async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Collect fees' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({ student_id: 'student-1' });
  });

  it('gates Collect fees by permission — a TEACHER sees View but not Collect fees', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByRole('link', { name: 'View' });
    expect(screen.queryByRole('link', { name: 'Collect fees' })).toBeNull();
  });

  it('bulk-selecting rows reveals Send reminder and Export CSV, hides them again once cleared', async () => {
    const students = [
      studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' }),
      studentFactory({ id: 'student-2', full_name: 'Karim Ahmed' }),
    ];
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: students, total: 2, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));

    expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull());
  });

  it('sends a reminder to every selected student and clears the selection on success', async () => {
    const students = [studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' })];
    let receivedStudentIds: string[] = [];
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: students, total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        const body = (await request.json()) as { student_ids: string[] };
        receivedStudentIds = body.student_ids;
        return HttpResponse.json(
          {
            id: 'batch-1',
            batch_name: 'Manual batch',
            status: 'COMPLETED',
            total_recipients: 1,
            successful_count: 1,
            failed_count: 0,
            message_template: null,
            created_at: new Date().toISOString(),
            skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
    await user.click(screen.getByRole('button', { name: 'Send reminder' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: 'Message' }), 'A reminder');
    await user.click(dialog.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(receivedStudentIds).toEqual(['student-1']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The selection clears once the batch is accepted — the bulk bar
    // (and its now-stale "Send reminder"/"Export CSV" actions) goes with it.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull());
  });

  it('filter -> result -> navigate to detail -> back -> state restored', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        const url = new URL(request.url);
        const matches = url.searchParams.get('enrollment_status') === 'ACTIVE';
        return HttpResponse.json({
          data: matches ? [student] : [],
          total: matches ? 1 : 0,
          page: 1,
          limit: 10,
          totalPages: 1,
        });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?enrollment_status=ACTIVE'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('link', { name: 'View' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'View' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));

    router.history.back();
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ enrollment_status: 'ACTIVE' }),
    );
    await screen.findByRole('link', { name: 'View' });
  });

  it('is axe clean', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('link', { name: 'View' });
    await expect(container).toHaveNoViolations();
  });
});
