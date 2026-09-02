import { cleanupTestState, classFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [8.10.4]'s dues queue — real route tree, not a hand-built double, so
 * `ListShell`/`DataTable` and the Flagged toggle actually wire up. Same
 * reasoning `students/index.test.tsx` documents for itself. */
describe('/fees/dues', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function duesRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-1',
      full_name: 'Karim Rahman',
      registration_number: 'REG-1',
      roll_number: 1,
      class_name: 'Class 5',
      section_name: 'A',
      total_due: 500,
      months_overdue: 0,
      dues: [
        {
          student_fee_id: 'fee-1',
          month: 3,
          year: 2026,
          total_amount: 500,
          paid_amount: 0,
          discount_amount: 0,
          balance: 500,
          status: 'PENDING',
          due_date: null,
          reminder_threshold_date: null,
        },
      ],
      ...overrides,
    };
  }

  it('renders the dues queue with derived status and amounts', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('shows Overdue status when months_overdue is greater than zero', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [duesRow({ months_overdue: 2 })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('the Flagged toggle preserves class/section filters and calls the flagged endpoint', async () => {
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    let flaggedRequested = false;
    let flaggedClassId: string | null = null;
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
      http.get('/api/v1/fees/dues/flagged', ({ request }) => {
        flaggedClassId = new URL(request.url).searchParams.get('class_id');
        flaggedRequested = true;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues?class_id=class-9'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await within(await screen.findByRole('combobox', { name: 'Class' })).findByText('Class 9');

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Show flagged/overdue accounts only' }));

    await waitFor(() => expect(flaggedRequested).toBe(true));
    expect(flaggedClassId).toBe('class-9');
    expect(router.state.location.search).toMatchObject({ class_id: 'class-9', flagged: 'true' });
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `FEE_COLLECT` — this was
  // [8.14.17]'s own headline audit finding (a TEACHER's direct visit
  // used to render every student's payment balance with only the
  // `Collect` link hidden). `_staff.access.test.tsx` covers this same
  // case across roles; this one stays local to the route it belongs to.
  it('refuses the whole route for a TEACHER, who lacks FEE_COLLECT', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByText(/Karim Rahman/)).toBeNull();
  });

  it('Collect reaches Record Payment in one interaction', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Collect' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({ student_id: 'student-1' });
  });

  it('bulk-selecting a row reveals Send reminder, Generate invoice and Export CSV', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));

    expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate invoice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('Generate invoice posts one invoice per selected row and clears the selection', async () => {
    let receivedBody: { student_id?: string; line_items?: unknown } | undefined;
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/invoices', async ({ request }) => {
        receivedBody = (await request.json()) as { student_id?: string; line_items?: unknown };
        return HttpResponse.json(
          { id: 'invoice-1', invoice_number: 'INV-2026-00001' },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
    await user.click(screen.getByRole('button', { name: 'Generate invoice' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(receivedBody?.student_id).toBe('student-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull());
  });

  it('exports the selected row to CSV with derived status and formula-leading values neutralized', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [duesRow({ full_name: '=cmd|/c calc' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    let capturedBlob: Blob | undefined;
    // jsdom doesn't implement `URL.createObjectURL`/`revokeObjectURL` at
    // all — same stub-and-restore pattern `students/index.test.tsx` uses.
    URL.createObjectURL = (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    };
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderWithRouter(routeTree, {
        initialEntries: ['/fees/dues'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
      await user.click(screen.getByRole('button', { name: 'Export CSV' }));

      const csv = await capturedBlob!.text();
      expect(csv).toContain("'=cmd|/c calc");
      expect(csv).not.toContain('\n=cmd');
    } finally {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it('is axe clean', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    await expect(container).toHaveNoViolations();
  });
});
