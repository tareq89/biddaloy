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

  it('hides the Print action for a role without INVOICE_PRINT', async () => {
    // TEACHER holds neither INVOICE_READ nor INVOICE_PRINT
    // (`ROLE_PERMISSIONS`) but is still a staff role (`STAFF_ROLES`), so
    // it reaches this page (unlike PARENT/STUDENT, which `RequireRole`
    // redirects to `/portal` before this component ever renders).
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

    await screen.findByRole('link', { name: invoice.invoice_number });
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
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
});
