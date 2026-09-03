import { cleanupTestState, invoiceFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/invoices/$invoiceId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the invoice number, student, status, amounts and dates', async () => {
    const invoice = invoiceFactory({
      id: 'invoice-1',
      invoice_number: 'INV-00000002',
      total_amount: 5000,
      tax_amount: 100,
      discount_amount: 50,
      status: 'PAID',
    });
    server.use(http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)));

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText('INV-00000002')).toBeTruthy();
    expect(screen.getByText(invoice.student.full_name)).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
  });

  it('Print opens the server-rendered printable route', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
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
        initialEntries: ['/invoices/invoice-1'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Print' }));

      await waitFor(() => expect(fakeWindow.location.href).toBe('blob:mock'));
    } finally {
      openSpy.mockRestore();
      delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    }
  });

  it('shows an error state with retry when the invoice fails to load', async () => {
    // 403 (not 5xx) — `shouldRetryQuery` (`ui/src/hooks/retry.ts`) never
    // retries a 4xx *within* one fetch attempt, so this settles into
    // `isError` after each individual attempt rather than TanStack Query
    // silently retrying it into a later `isSuccess` on its own.
    //
    // [8.14.5]: two attempts must fail here, not one — `$invoiceId.tsx`'s
    // own `loader` now warms this same query first (attempt 1), and
    // TanStack Query's `retryOnMount` (default `true`) fires a second,
    // independent attempt the instant the component observes that
    // still-errored query (attempt 2). Only the third attempt, triggered
    // by this test's own "Try again" click, is meant to succeed.
    let attempts = 0;
    server.use(
      http.get('/api/v1/invoices/:id', () => {
        attempts += 1;
        return attempts <= 2
          ? HttpResponse.json(
              {
                statusCode: 403,
                message: 'Forbidden',
                timestamp: new Date().toISOString(),
                path: '/api/v1/invoices/invoice-1',
                requestId: 'req-1',
              },
              { status: 403 },
            )
          : HttpResponse.json(invoiceFactory({ id: 'invoice-1' }));
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText("Couldn't load this invoice.")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByText("Couldn't load this invoice.")).toBeNull());
  });

  it('is axe clean', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(invoice.invoice_number);
    await expect(container).toHaveNoViolations();
  });

  // [8.14.13]: same permission + status gate as the list page's own
  // "Record payment" action.
  it.each(['ISSUED', 'OVERDUE'] as const)(
    'shows "Record payment" for a %s invoice, linking to /payments/record with its student_id',
    async (status) => {
      const invoice = invoiceFactory({ id: 'invoice-1', student_id: 'student-9', status });
      server.use(http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)));

      renderWithRouter(routeTree, {
        initialEntries: ['/invoices/invoice-1'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      await screen.findByText(invoice.invoice_number);
      const link = screen.getByRole('link', { name: 'Record payment' });
      expect(link.getAttribute('href')).toBe('/payments/record?student_id=student-9');
    },
  );

  it.each(['DRAFT', 'PAID', 'CANCELLED'] as const)(
    'hides "Record payment" for a %s invoice',
    async (status) => {
      const invoice = invoiceFactory({ id: 'invoice-1', student_id: 'student-9', status });
      server.use(http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)));

      renderWithRouter(routeTree, {
        initialEntries: ['/invoices/invoice-1'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      await screen.findByText(invoice.invoice_number);
      expect(screen.queryByRole('link', { name: 'Record payment' })).toBeNull();
    },
  );
});
