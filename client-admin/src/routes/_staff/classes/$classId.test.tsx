import {
  academicYearFactory,
  classFactory,
  classHandlers,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.2]'s detail page — real `DetailShell`/`useDetailShellTab` against
 * the real route tree, same reasoning `academic-years/$academicYearId.test.tsx`'s
 * own header comment. Four tabs: Sections, Students, Fee Structures,
 * Teachers.
 */
describe('/classes/$classId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('deep-links via ?tab= — opening straight at ?tab=teachers shows the Teachers tab, not Sections', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/teachers', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Teachers', selected: true })).toBeTruthy(),
    );
  });

  it('the Sections tab renders sections with capacity and enrolled count', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([
          {
            id: 'section-1',
            class_id: 'class-1',
            section_name: 'A',
            capacity: 40,
            enrolled_count: 30,
            tenant_id: 'tenant-1',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Class 6' });
    const row = (await screen.findByText('A')).closest('tr') as HTMLElement;
    // Numbers go through `formatNumber` (tenant numerals; default region is Bangla).
    expect(within(row).getByText(/^(40|৪০)$/)).toBeTruthy();
    expect(within(row).getByText(/^(30|৩০)$/)).toBeTruthy();
    // Icon row actions, not underlined text links; one primary add button.
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add section' })).toBeTruthy();
  });

  it('shows facts instead of a back link, and a section count', async () => {
    const klass = {
      ...classFactory({ id: 'class-1', name: 'Class 6', numeric_grade: 6 }),
      shift: 'Morning',
      version: 'Bangla',
    };
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Class 6' });
    // Only the breadcrumb remains (it used to be a second, underlined link).
    expect(within(screen.getByRole('main')).getAllByRole('link', { name: 'Classes' })).toHaveLength(
      1,
    );
    expect(screen.getByText('Morning')).toBeTruthy();
    expect(screen.getByText('Bangla')).toBeTruthy();
    expect(screen.getByText(/^(6|৬)$/)).toBeTruthy();
    expect(screen.getByText(/^(0|০)\s*sections?$|^(0|০)টি$/)).toBeTruthy();
  });

  it('saving the Edit dialog without touching shift/version keeps them (not null)', async () => {
    const year = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });
    const klass = {
      ...classFactory({ id: 'class-1', name: 'Class 6', academic_year: year }),
      shift: 'Morning',
      version: 'Bangla',
    };
    let patchBody: Record<string, unknown> | undefined;
    server.use(
      classHandlers.vocabularyPopulated,
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
      http.patch('/api/v1/classes/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(klass);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    // The vocabulary arrives async; wait for the shift select to render.
    await dialog.findByRole('combobox', { name: 'Shift' });
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody?.shift).toBe('Morning');
    expect(patchBody?.version).toBe('Bangla');
  });

  it("clearing a section's Capacity and saving sends an explicit null, not an omitted key", async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
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
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const row = (await screen.findByText('A')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.clear(dialog.getByLabelText('Capacity'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchBody).toEqual({ section_name: 'A', capacity: null });
  });

  it('a group literally named "__none__" reaches the section create payload', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/classes/vocabulary', () =>
        HttpResponse.json({ shifts: [], versions: [], groups: ['__none__', 'Commerce'] }),
      ),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
      http.post('/api/v1/classes/:classId/sections', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(classSectionFactory({ id: 'new-section' }), { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add section' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Section name/), 'A');
    await user.click(await dialog.findByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: '__none__' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.group_name).toBe('__none__');
  });

  it('deleting a section that still has students shows the translated sentence, not the server text', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([
          {
            ...classSectionFactory({ id: 'section-1', section_name: 'A', class_id: 'class-1' }),
            capacity: 40,
            enrolled_count: 3,
          },
        ]),
      ),
      http.delete('/api/v1/classes/:classId/sections/:sectionId', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Cannot delete section "section-1": 3 student(s) enrolled',
            timestamp: new Date().toISOString(),
            path: '/api/v1/classes/class-1/sections/section-1',
            requestId: 'req-1',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const row = (await screen.findByText('A')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await dialog.findByText(/still has students, so it can't be deleted/);
    expect(dialog.queryByText(/section-1/)).toBeNull();
  });

  it('the Teachers tab lists section assignments with an assign action [29.0]', async () => {
    const klass = classFactory({ id: 'class-1' });
    const section = classSectionFactory({ id: 'section-1', class: klass, section_name: 'A' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...section, enrolled_count: 0 }]),
      ),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([
          {
            id: 'assignment-1',
            teacher_id: 'teacher-1',
            employee_id: 'EMP-001',
            full_name: 'Rahim Uddin',
            section_id: section.id,
            section_name: section.section_name,
            subject_id: null,
            subject_name: null,
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=teachers'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(/Rahim Uddin/);
    // [29.0] Assignment CRUD lives here now (Teacher-entity CRUD stays #177).
    expect(screen.queryByRole('button', { name: /add teacher/i })).toBeNull();
  });

  it('renders Edit/Delete for ADMIN, who holds CLASS_MANAGE', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Sections' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `CLASS_MANAGE` — before this
  // ticket the route still rendered for them with these buttons hidden,
  // a partial view [8.14.17] intentionally replaces with a blanket
  // refusal.
  it('refuses the whole route for TEACHER, who lacks CLASS_MANAGE', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Sections' })).toBeNull();
  });

  it('clearing Grade and saving sends an explicit null, not an omitted key', async () => {
    // Regression coverage for the "cleared numeric field silently keeps
    // its old value" defect: `ClassService.update` passes the PATCH
    // body straight into `repo.update()`, which only touches keys
    // actually present — an omitted `numeric_grade` would leave the old
    // value in place even though the dialog reported success.
    const klass = classFactory({ id: 'class-1', name: 'Class 6', numeric_grade: 6 });
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
      http.patch('/api/v1/classes/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...klass, numeric_grade: null });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    const gradeInput = dialog.getByLabelText('Grade');
    await user.clear(gradeInput);
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchBody).toEqual({ name: 'Class 6', numeric_grade: null });
  });

  it('deleting the class navigates back to the classes list', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Delete Me' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
      http.delete('/api/v1/classes/:id', () => new HttpResponse(null, { status: 200 })),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/classes'));
  });

  it('a tab whose endpoint 403s shows a clear message instead of crashing the page', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/classes/class-1/sections',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have permission to view this.")).toBeTruthy();
  });

  it('is axe clean', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // Waits for the (default-active) Sections tab's own fetch to settle
    // too — otherwise it resolves after this test's own assertions, which
    // React logs as an unwrapped `act()` update.
    await screen.findByText('No sections yet');
    await expect(container).toHaveNoViolations();
  });
});
