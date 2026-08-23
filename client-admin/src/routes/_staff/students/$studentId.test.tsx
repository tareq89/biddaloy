import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
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
});
