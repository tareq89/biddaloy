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
 * [8.10.2]'s full detail page — real `DetailShell`/`useDetailShellTab`
 * against the real route tree, same reasoning as `index.test.tsx`'s own
 * header comment. Every case carries a `role` since `/students/$studentId`
 * sits under `_staff`.
 */
describe('/students/$studentId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('deep-links via ?tab= — opening straight at ?tab=fees shows the Fees tab, not Overview', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=fees'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Fees', selected: true })).toBeTruthy(),
    );
  });

  it('opening the page fires only the student request — the other seven tabs stay unfetched until activated', async () => {
    const student = studentFactory({ id: 'student-1' });
    let enrollmentCalls = 0;
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => {
        enrollmentCalls += 1;
        return HttpResponse.json([]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy());
    // Give a wrongly-eager fetch every chance to have already fired.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enrollmentCalls).toBe(0);
  });

  it('activating a tab fetches its data once, then reuses the cached panel — switching away and back does not refetch', async () => {
    const student = studentFactory({ id: 'student-1' });
    let enrollmentCalls = 0;
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => {
        enrollmentCalls += 1;
        return HttpResponse.json([]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Enrollment' }));
    await waitFor(() => expect(enrollmentCalls).toBe(1));

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('tab', { name: 'Enrollment' }));

    // Still one — DetailShell keeps a visited panel mounted rather than
    // unmounting it on tab switch, so no second fetch fires on return.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enrollmentCalls).toBe(1);
  });

  it('Fees tab shows outstanding and paid balance clearly', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      // No `region` key — `useTenantRegionConfig` falls back to the
      // locale-derived default (latin digits, 2 decimals) instead of
      // `handlers/schools.ts`'s own bengali-numeral/0-decimal default
      // fixture, so the assertions below are deterministic regardless of
      // whatever that shared fixture happens to be tuned for elsewhere.
      http.get('/api/v1/schools/:schoolId/settings', () => HttpResponse.json({})),
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: student.full_name,
          summary: { total_due: 5000, total_paid: 3000, total_discount: 0, balance: 2000 },
          fee_breakdown: [],
          payments: [],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=fees'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('৳5,000.00')).toBeTruthy();
    expect(screen.getByText('৳3,000.00')).toBeTruthy();
    expect(screen.getByText('৳2,000.00')).toBeTruthy();
  });

  it('gates page actions by permission — ADMIN sees all five, ACCOUNTANT only Collect fees and Send reminder', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { unmount } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: student.full_name });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect fees' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reminder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transfer / change status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    unmount();

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: student.full_name });
    expect(screen.getByRole('button', { name: 'Collect fees' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reminder' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer / change status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('clicking Edit navigates to the edit placeholder page, not a dead end', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1/edit'));
    // The edit route opts out of nesting under `$studentId` (a
    // `$studentId_.edit.tsx` file, not `$studentId.edit.tsx`) — without
    // that, the parent page never renders an `<Outlet />` and this
    // heading would never appear.
    expect(await screen.findByRole('heading', { name: 'Edit student' })).toBeTruthy();
  });

  it('a tab whose endpoint 403s shows a clear message instead of crashing the page', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/enrollments/student/student-1',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have permission to view this.")).toBeTruthy();
  });

  it('deleting the student navigates back to the students list', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.delete('/api/v1/students/:id', () => new HttpResponse(null, { status: 200 })),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('changing the enrollment status via the Transfer / change status dialog updates the badge', async () => {
    // A mutable fixture, not a fixed response — `onSuccess` invalidates
    // the detail query, which refetches via `GET`; if that handler kept
    // returning the original `ACTIVE` student, the mutation's own
    // (correct) response would get immediately overwritten by the
    // refetch, same reasoning as `index.test.tsx`'s `useCreateStudent` fixture.
    let currentStudent = studentFactory({ id: 'student-1', enrollment_status: 'ACTIVE' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(currentStudent)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        const body = (await request.json()) as { enrollment_status: string };
        currentStudent = {
          ...currentStudent,
          enrollment_status: body.enrollment_status as typeof currentStudent.enrollment_status,
        };
        return HttpResponse.json(currentStudent);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Transfer / change status' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Transferred' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Transferred')).toBeTruthy();
  });

  it('[8.11.3] Move class dialog PATCHes the current enrollment when one already exists', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const targetClass = classFactory({ id: 'class-2', name: 'Class Two' });
    const targetSection = classSectionFactory({
      id: 'section-2',
      class: targetClass,
      section_name: 'B',
      capacity: 40,
    });
    let patchBody: unknown;

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([])),
      http.get('/api/v1/enrollments/:studentId/current', () =>
        HttpResponse.json({
          id: 'enrollment-1',
          student_id: 'student-1',
          class_id: 'class-1',
          section_id: 'section-1',
          academic_year_id: 'ay-1',
          enrollment_status: 'ACTIVE',
        }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [targetClass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([targetSection])),
      http.patch('/api/v1/enrollments/:id', async ({ params, request }) => {
        patchBody = await request.json();
        return HttpResponse.json({
          id: params.id,
          student_id: 'student-1',
          ...(patchBody as object),
          enrollment_status: 'ACTIVE',
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Move class' }));
    const dialog = within(await screen.findByRole('dialog'));

    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class Two' }));
    await user.click(dialog.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));
    await user.click(dialog.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchBody).toEqual({ class_id: 'class-2', section_id: 'section-2' });
  });

  it('[8.11.3] Move class dialog blocks submission and shows an error when the current-enrollment lookup fails', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const targetClass = classFactory({ id: 'class-2', name: 'Class Two' });
    const targetSection = classSectionFactory({
      id: 'section-2',
      class: targetClass,
      section_name: 'B',
      capacity: 40,
    });
    let createCalled = false;

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([])),
      // A failed GET must not be treated the same as a successful "no
      // current enrollment" — that would wrongly take the create-fresh-row
      // branch below and duplicate an existing active enrollment.
      // A 4xx status so `shouldRetryQuery` fails fast instead of retrying
      // with backoff — this only needs to exercise the error state, not
      // any particular status code.
      http.get('/api/v1/enrollments/:studentId/current', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Bad Request',
            timestamp: new Date().toISOString(),
            path: '/api/v1/enrollments/student-1/current',
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [targetClass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([targetSection])),
      http.post('/api/v1/enrollments', () => {
        createCalled = true;
        return HttpResponse.json(
          { id: 'enrollment-new', student_id: 'student-1', enrollment_status: 'ACTIVE' },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Move class' }));
    const dialog = within(await screen.findByRole('dialog'));

    expect(
      await dialog.findByText("Couldn't load the student's current enrollment. Try again."),
    ).toBeTruthy();

    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class Two' }));
    await user.click(dialog.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));

    expect(dialog.getByRole('button', { name: 'Move' })).toHaveProperty('disabled', true);
    expect(createCalled).toBe(false);
  });

  it('[8.11.3] Move class dialog POSTs a fresh enrollment for a legacy student with no current row', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const targetClass = classFactory({ id: 'class-2', name: 'Class Two' });
    const targetSection = classSectionFactory({
      id: 'section-2',
      class: targetClass,
      section_name: 'B',
      capacity: 40,
    });
    let postBody: unknown;

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([])),
      // No current ACTIVE enrollment — the get-or-create fallback branch.
      http.get('/api/v1/enrollments/:studentId/current', () => HttpResponse.json(null)),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [targetClass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([targetSection])),
      http.post('/api/v1/enrollments', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json(
          { id: 'enrollment-new', ...(postBody as object), enrollment_status: 'ACTIVE' },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Move class' }));
    const dialog = within(await screen.findByRole('dialog'));

    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class Two' }));
    await user.click(dialog.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));
    await user.click(dialog.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postBody).toEqual({
      student_id: 'student-1',
      class_id: 'class-2',
      section_id: 'section-2',
      academic_year_id: targetClass.academic_year_id,
    });
  });

  it('[8.11.3] Move class dialog warns (but does not block) when the selected section is at capacity', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const targetClass = classFactory({ id: 'class-2', name: 'Class Two' });
    // Full section — enrolled_count equals capacity.
    const fullSection = classSectionFactory({
      id: 'section-2',
      class: targetClass,
      section_name: 'B',
      capacity: 5,
    });

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([])),
      http.get('/api/v1/enrollments/:studentId/current', () => HttpResponse.json(null)),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [targetClass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...fullSection, enrolled_count: 5 }]),
      ),
      http.post('/api/v1/enrollments', () =>
        HttpResponse.json(
          {
            id: 'enrollment-new',
            student_id: 'student-1',
            class_id: 'class-2',
            section_id: 'section-2',
            enrollment_status: 'ACTIVE',
          },
          { status: 201 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Move class' }));
    const dialog = within(await screen.findByRole('dialog'));

    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class Two' }));
    await user.click(dialog.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));

    expect((await dialog.findByRole('status')).textContent).toContain('5/5');

    // Warns, does not block — submit still succeeds.
    await user.click(dialog.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is axe clean', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: student.full_name });
    await expect(container).toHaveNoViolations();
  });

  it('[8.11.3] is axe clean with the Move class dialog open, including the capacity warning', async () => {
    const student = studentFactory({ id: 'student-1' });
    const targetClass = classFactory({ id: 'class-2', name: 'Class Two' });
    const fullSection = classSectionFactory({
      id: 'section-2',
      class: targetClass,
      section_name: 'B',
      capacity: 5,
    });

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/enrollments/student/:studentId', () => HttpResponse.json([])),
      http.get('/api/v1/enrollments/:studentId/current', () => HttpResponse.json(null)),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [targetClass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ ...fullSection, enrolled_count: 5 }]),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=enrollment'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Move class' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class Two' }));
    await user.click(dialog.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));
    await dialog.findByRole('status');

    await expect(container).toHaveNoViolations();
  });
});
