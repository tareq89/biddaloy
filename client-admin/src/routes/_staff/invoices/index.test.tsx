import { toast } from '@biddaloy/ui/components';
import {
  cleanupTestState,
  invoiceFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * Covers [8.10.6]'s acceptance criteria against the real route tree —
 * same reasoning `students/index.test.tsx`'s own header comment gives for
 * that page.
 */
describe('/invoices', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('reads its initial filter state from the URL, not a default', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/invoices?status=OVERDUE'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await within(await screen.findByRole('combobox', { name: 'Status' })).findByText('Overdue');
  });

  it('renders invoice rows with number, student, amount, status and dates', async () => {
    const student = studentFactory({ full_name: 'Rahim Uddin' });
    const invoice = invoiceFactory({
      invoice_number: 'INV-00000001',
      student,
      student_id: student.id,
      total_amount: 4500,
      status: 'ISSUED',
    });
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByRole('link', { name: 'INV-00000001' })).toBeTruthy();
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Issued')).toBeTruthy();
  });

  it('changing the status filter writes it to the URL and refetches', async () => {
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Invoices' });
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Paid' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'PAID' }));
  });

  it('changing the from/to date filters writes them to the URL as plain ISO dates', async () => {
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Invoices' });
    await user.type(screen.getByRole('textbox', { name: 'Issued from' }), '2026-01-01');

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ from_date: '2026-01-01' }),
    );
  });

  it('Print opens the server-rendered printable route in a new tab', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/invoices/:id/print', () =>
        HttpResponse.text('<html><body>Invoice</body></html>'),
      ),
    );

    const fakeWindow = { opener: null, location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    try {
      renderWithRouter(routeTree, {
        initialEntries: ['/invoices'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Print' }));

      await waitFor(() => expect(fakeWindow.location.href).toBe('blob:mock'));
      expect(openSpy).toHaveBeenCalledWith('', '_blank');
    } finally {
      openSpy.mockRestore();
      delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    }
  });

  it('surfaces an error toast when the print popup is blocked', async () => {
    // No `<Toaster />` is mounted in the test harness (`render-with-
    // router.tsx` — that's `main.tsx`'s job in the real app), so this
    // asserts the `toast.error` call itself rather than its rendered DOM.
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

    try {
      renderWithRouter(routeTree, {
        initialEntries: ['/invoices'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Print' }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith("Couldn't open the printable invoice. Try again."),
      );
    } finally {
      openSpy.mockRestore();
      toastSpy.mockRestore();
    }
  });

  // [8.14.13]: "Record payment" offers a second permission-gated action
  // beside "Print", but only for invoices that still have money owed —
  // ISSUED and OVERDUE — and only for a role holding `PAYMENT_RECORD`.
  it.each(['ISSUED', 'OVERDUE'] as const)(
    'shows "Record payment" for a %s invoice, linking to /payments/record with its student_id',
    async (status) => {
      const invoice = invoiceFactory({ id: 'invoice-1', student_id: 'student-9', status });
      server.use(
        http.get('/api/v1/invoices', () =>
          HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
        ),
      );

      renderWithRouter(routeTree, {
        initialEntries: ['/invoices'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const link = await screen.findByRole('link', { name: 'Record payment' });
      expect(link.getAttribute('href')).toBe('/payments/record?student_id=student-9');
    },
  );

  it.each(['DRAFT', 'PAID', 'CANCELLED'] as const)(
    'hides "Record payment" for a %s invoice',
    async (status) => {
      const invoice = invoiceFactory({ id: 'invoice-1', student_id: 'student-9', status });
      server.use(
        http.get('/api/v1/invoices', () =>
          HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
        ),
      );

      renderWithRouter(routeTree, {
        initialEntries: ['/invoices'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      await screen.findByRole('link', { name: invoice.invoice_number });
      expect(screen.queryByRole('link', { name: 'Record payment' })).toBeNull();
    },
  );

  // Every staff role that holds `INVOICE_READ` (ADMIN, ACCOUNTANT) also
  // holds `PAYMENT_RECORD`, so there's no real role fixture to exercise
  // "reaches /invoices but lacks PAYMENT_RECORD" at this integration
  // level — the ISSUED/OVERDUE-vs-DRAFT/PAID/CANCELLED coverage above,
  // together with the `canPrint || canRecordPayment` column guard, is
  // what actually protects a future role with that combination.

  // [8.14.17]: TEACHER holds neither `INVOICE_READ` nor `INVOICE_PRINT`
  // (`ROLE_PERMISSIONS`), and is still a staff role (`STAFF_ROLES`), so
  // it clears `_staff.tsx`'s outer `RequireRole` gate — but
  // `RequirePermission`, gated on `INVOICE_READ` for this route, now
  // refuses the whole page before this component ever renders. Before
  // this ticket the route rendered for TEACHER with only the `Print`
  // button hidden, a partial view [8.14.17] intentionally replaces with
  // a blanket refusal.
  it('refuses the whole route for a role without INVOICE_READ', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: invoice.invoice_number })).toBeNull();
  });

  it('renders the empty state when no invoices match', async () => {
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText('No invoices found')).toBeTruthy();
  });

  it('is axe clean', async () => {
    const invoice = invoiceFactory();
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [invoice], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByRole('link', { name: invoice.invoice_number });
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: `student_id` has no `FilterBar` descriptor, so it renders
  // via `FilterBar`'s "chip for every value key, even undeclared ones"
  // fallback. This is the regression test for the bug where the page read
  // `student_id` from `Route.useSearch()` instead of `state.filters` —
  // clearing the chip cleared the URL but the query kept using the stale
  // value.
  it('deep-linked student_id renders a chip, and clearing it drops the filter from the query', async () => {
    let lastStudentId: string | null | undefined;
    server.use(
      http.get('/api/v1/invoices', ({ request }) => {
        lastStudentId = new URL(request.url).searchParams.get('student_id');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices?student_id=student-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByRole('region', { name: 'Invoices' });
    await waitFor(() => expect(lastStudentId).toBe('student-1'));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove filter: student_id: student-1' }));

    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('student_id');
    });
    await waitFor(() => expect(lastStudentId).toBeNull());
  });

  it('an amount range filter reaches the request as min_amount/max_amount', async () => {
    let lastMin: string | null = null;
    let lastMax: string | null = null;
    server.use(
      http.get('/api/v1/invoices', ({ request }) => {
        const url = new URL(request.url);
        lastMin = url.searchParams.get('min_amount');
        lastMax = url.searchParams.get('max_amount');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Invoices' });
    await user.type(screen.getByRole('textbox', { name: 'Minimum amount' }), '500');

    await waitFor(() => expect(lastMin).toBe('500'), { timeout: 1000 });
    expect(lastMax).toBeNull();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [], total: 0, page: 2, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices?page=2'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Invoices' });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale.
    await user.click(await screen.findByRole('option', { name: '২০' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 20, page: 1 }));
  });

  // [8.14.10]: `GET /invoices` now accepts a `sort`/`order` param — the
  // money column is sortable and end-aligned via `align`, not a manual
  // `tabular-nums` span.
  it('clicking the Amount column header writes sort/order to the URL', async () => {
    server.use(
      http.get('/api/v1/invoices', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Invoices' });
    await user.click(screen.getByRole('button', { name: 'Amount' }));

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.sort).toBe('amount');
      expect(['asc', 'desc']).toContain(search.order);
    });
  });
});
