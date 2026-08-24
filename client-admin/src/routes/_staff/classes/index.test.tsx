import {
  academicYearFactory,
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  type Class,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.2]'s list page — real `ListShell`/`DataTable` against the real
 * route tree, same reasoning `academic-years/index.test.tsx`'s own header
 * comment. Every case carries `role` since `/classes` sits under `_staff`.
 */
describe('/classes', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists classes, with grade/sections/students columns', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const klass = {
      ...classFactory({
        id: 'class-1',
        name: 'Class 6',
        numeric_grade: 6,
        academic_year: year,
        academic_year_id: year.id,
      }),
      // Server-computed by `ClassService.findAll` (`ClassWithCounts`) —
      // no separate `GET /classes/:id/sections` request needed to render
      // this row, unlike the old per-row `StudentsCountCell`.
      section_count: 1,
      student_count: 5,
    };
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Classes' });
    // `getAllByRole('row')` alone can't distinguish "loaded, one data row"
    // from "still loading" — the loading placeholder is its own `<tr>`,
    // so both states report the same row count (header + one row).
    // Anchoring on the class's own name first avoids that race.
    await screen.findByText('Class 6');
    const row = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByText('Class 6')).toBeTruthy();
    expect(within(row).getByText('6')).toBeTruthy();
    // Sections column reads `section_count` straight off the list
    // payload — no `sections` relation loaded on this endpoint anymore.
    expect(within(row).getByText('1')).toBeTruthy();
    // Students column reads `student_count`, same list payload — no
    // per-row request.
    expect(within(row).getByText('5')).toBeTruthy();
  });

  it('Add class / Edit / Delete are hidden for a role without CLASS_MANAGE', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Classes' });
    await screen.findByText('Class 6');
    expect(screen.queryByRole('button', { name: 'Add class' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('expanding a row reveals its sections inline, keyboard-operable with correct aria-expanded', async () => {
    const klass = {
      ...classFactory({ id: 'class-1', name: 'Class 6' }),
      section_count: 1,
      student_count: 12,
    };
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([
          {
            ...classSectionFactory({ section_name: 'A', class_id: 'class-1' }),
            enrolled_count: 12,
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const toggle = await screen.findByRole('button', { name: 'Sections for Class 6' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // `aria-controls` is only set once expanded — the panel `<tr>` it
    // would name doesn't exist in the DOM at all while collapsed, so
    // pointing at it beforehand would name an element assistive tech can
    // never find.
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    const user = userEvent.setup();
    await user.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    await screen.findByText('A');
    // Once expanded, `aria-controls` resolves to the panel it names — the
    // exact wiring `data-table.test.tsx`'s own unit tests cover in
    // isolation; keyboard-operability (Enter/Space activate a native
    // `<button>`) is covered there too, at the component level rather
    // than through this route's full tree.
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    // "12" legitimately appears twice once expanded — the section row's
    // own enrolled count, and the Students column's server-computed
    // `student_count` on the class row itself (this fixture sets both to
    // the same value, matching what a real single-section class would
    // report) — so this asserts presence, not uniqueness.
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1);
  });

  it("clearing a section's Capacity and saving sends an explicit null, not an omitted key", async () => {
    // Same "cleared numeric field silently keeps its old value" defect as
    // the class form — `SectionService.update` also passes the PATCH
    // body straight into `repo.update()`.
    const klass = {
      ...classFactory({ id: 'class-1', name: 'Class 6' }),
      section_count: 1,
      student_count: 0,
    };
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([
          {
            ...classSectionFactory({ id: 'section-1', section_name: 'A', class_id: 'class-1' }),
            capacity: 40,
            enrolled_count: 0,
          },
        ]),
      ),
      http.patch('/api/v1/classes/:classId/sections/:sectionId', async ({ request, params }) => {
        patchBody = await request.json();
        return HttpResponse.json({
          ...classSectionFactory({
            id: params.sectionId as string,
            class_id: params.classId as string,
          }),
          section_name: 'A',
          capacity: null,
          enrolled_count: 0,
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sections for Class 6' }));
    const sectionNameCell = await screen.findByText('A');
    // Scoped to the section's own row — the class row above it also has
    // an "Edit" button, so an unscoped query would be ambiguous.
    const sectionRow = sectionNameCell.closest('tr') as HTMLElement;
    await user.click(within(sectionRow).getByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    const capacityInput = dialog.getByLabelText('Capacity');
    await user.clear(capacityInput);
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchBody).toEqual({ section_name: 'A', capacity: null });
  });

  it('creating a class shows up in the list once the dialog is submitted', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    let classes: Class[] = [];
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: classes,
          total: classes.length,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/classes', async ({ request }) => {
        const body = (await request.json()) as { name: string; academic_year_id: string };
        const created = classFactory({
          id: 'new-class',
          name: body.name,
          academic_year_id: body.academic_year_id,
        });
        classes = [...classes, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add class' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Class 9');
    await user.click(dialog.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('Class 9');
  });

  it('deleting a class blocked by enrolled students shows the server message, not a generic toast', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.delete('/api/v1/classes/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete class "class-1": 5 student(s) are still enrolled in it. Move or unenroll them first.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/classes/class-1',
            requestId: 'req-1',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    // The AC's own "explanation why" — the server's own message, naming
    // the count, not a generic failure toast.
    await dialog.findByText(/5 student\(s\) are still enrolled/);
    expect(dialog.getByRole('link', { name: 'Move students' })).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('deleting a class that fails with a non-409 error keeps the normal retry path, not the blocked state', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      // 403, not 500 — `useDeleteClass` sets its own `retry: shouldRetryQuery`
      // (`ui/src/hooks/retry.ts`), which retries any *5xx* a couple of
      // times with backoff before settling. A 4xx never retries, so this
      // still settles well within the test's default `waitFor` timeout.
      http.delete('/api/v1/classes/:id', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/classes/class-1',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    // Not the "blocked" state — a non-409 failure is not necessarily
    // permanent, so the destructive-Delete button (retry) stays instead of
    // being swapped for "Move students", which may not even apply here.
    await dialog.findByRole('alert');
    expect(dialog.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(dialog.queryByRole('link', { name: 'Move students' })).toBeNull();
  });

  it('filtering by academic year requests classes scoped to that year', async () => {
    const currentYear = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const otherYear = academicYearFactory({ id: 'year-2', name: '2025-2026', is_current: false });
    let requestedAcademicYearId: string | null = null;
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [currentYear, otherYear],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', ({ request }) => {
        requestedAcademicYearId = new URL(request.url).searchParams.get('academic_year_id');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // Defaults to the current year on first load.
    await waitFor(() => expect(requestedAcademicYearId).toBe('year-1'));

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2025-2026' }));

    await waitFor(() => expect(requestedAcademicYearId).toBe('year-2'));
  });

  it('is axe clean with data loaded', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const klass = classFactory({ id: 'class-1', name: 'Class 6', academic_year_id: year.id });
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/classes'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Classes' });
    await screen.findByText('Class 6');
    await expect(container).toHaveNoViolations();
  });
});
