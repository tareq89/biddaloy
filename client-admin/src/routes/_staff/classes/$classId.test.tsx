import { classFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
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
    await screen.findByText('A');
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('the Teachers tab is read-only — no add/remove controls', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/teachers', () =>
        HttpResponse.json([
          {
            id: 'teacher-1',
            employee_id: 'EMP-001',
            full_name: 'Rahim Uddin',
            designations: ['CLASS_TEACHER'],
            section_names: ['A', 'B'],
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

    await screen.findByText('Rahim Uddin');
    expect(screen.getByText('EMP-001')).toBeTruthy();
    expect(screen.getByText('A, B')).toBeTruthy();
    // Read-only — teacher CRUD is #177, not this tab.
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
    const dialog = within(await screen.findByRole('dialog'));
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
