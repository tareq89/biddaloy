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
import { pickDate } from '../../../test/pick-date';

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
    // Year column is the stored name (not a number derived from the start date).
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: '2026-2027' })).toBeTruthy();
    // One long-form period, never the ISO date.
    expect(within(rows[1] as HTMLElement).getByText(/January.*December.*20\d\d/)).toBeTruthy();
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}/)).toBeNull();
    // Unpaginated: a total instead of a pager.
    // (default region renders Bangla digits even in the en locale; accept either)
    expect(screen.getByText(/^Total (2|২)$/)).toBeTruthy();
    expect(screen.queryByText(/Page \d+ of/)).toBeNull();
  });

  it('renders Add/View/Edit/Delete for ADMIN, who holds ACADEMIC_YEAR_MANAGE, and no Set as current', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.getByRole('button', { name: 'Add academic year' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set as current' })).toBeNull();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `ACADEMIC_YEAR_MANAGE` — before
  // this ticket the route still rendered for them with the table visible
  // and only the write buttons hidden, a partial view [8.14.17]
  // intentionally replaces with a blanket refusal.
  it('refuses the whole route for TEACHER, who lacks ACADEMIC_YEAR_MANAGE', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Academic Years' })).toBeNull();
  });

  it('creating a year shows up in the list once the dialog is submitted', async () => {
    let years: AcademicYear[] = [];
    let posted: unknown;
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: years, total: years.length, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/academic-years', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        posted = body;
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
    await user.click((await screen.findAllByRole('button', { name: 'Add academic year' }))[0]!);

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Name/), '2027-2028');
    await pickDate(user, 'Start date', '2027-01-01');
    await pickDate(user, 'End date', '2027-12-31');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(posted).toEqual({
      name: '2027-2028',
      start_date: '2027-01-01',
      end_date: '2027-12-31',
      is_current: false,
    });
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
    await user.click((await screen.findAllByRole('button', { name: 'Add academic year' }))[0]!);

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Name/), 'Bad Year');
    await pickDate(user, 'Start date', '2027-12-31');
    await pickDate(user, 'End date', '2027-01-01');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await dialog.findByText('End date must be after the start date')).toBeTruthy();
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
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/Delete "Delete Me"\?/)).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('No academic years yet')).toBeTruthy());
    expect(
      screen.getByText('Classes, fee structures and admissions belong to a year — add one first.'),
    ).toBeTruthy();
  });

  // [14.13.2]: an empty list is where a newcomer migrating a whole school
  // is already looking — the migrate-in entry point offers the workbook
  // template right there, gated on BACKUP_MANAGE same as its neighbours.
  it('shows the migrate-a-whole-school link when the list is empty, for ADMIN (BACKUP_MANAGE)', async () => {
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

    await screen.findByText('No academic years yet');
    expect(await screen.findByText('Migrating a whole school?')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Use the full workbook template' });
    expect(link.getAttribute('href')).toBe('/settings');
  });

  // No other role holds ACADEMIC_YEAR_MANAGE (this route's own view gate,
  // `route-permissions.ts`), so there is no reachable role that can view
  // this empty list while lacking BACKUP_MANAGE — unlike `/students`,
  // whose broader viewer set makes that negative case meaningful. The
  // `canManageBackup` check stays for defense-in-depth (same UX-only
  // reasoning as `students/import.tsx`), just with no test able to
  // exercise its "hidden" branch on this particular route.

  it('Cancel on an edited year form asks before discarding, and Keep editing keeps the form', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Add academic year' }))[0]!);
    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByLabelText(/^Name/), 'Draft');
    await user.click(form.getByRole('button', { name: 'Cancel' }));

    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText('Discard your changes?')).toBeTruthy();
    await user.click(confirm.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Draft');
  });

  it("shows an em dash (not 0) and an unavailable label when a year's stats fail to load", async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [academicYearFactory({ id: 'year-1' })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ statusCode: 400, message: 'bad' }, { status: 400 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    await waitFor(() => expect(within(row).getAllByText("Couldn't load")).toHaveLength(2));
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('opening edit on another year clears the previous edit error', async () => {
    const a = academicYearFactory({ id: 'year-a', name: 'Year A' });
    const b = academicYearFactory({ id: 'year-b', name: 'Year B' });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [a, b], total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.patch('/api/v1/academic-years/:id', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const first = within(await screen.findByRole('dialog'));
    await user.click(first.getByRole('button', { name: 'Save' }));
    expect(await first.findByText('Failed to save academic year')).toBeTruthy();
    await user.click(first.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    const second = within(await screen.findByRole('dialog'));
    expect(second.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(second.queryByText('Failed to save academic year')).toBeNull();
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
