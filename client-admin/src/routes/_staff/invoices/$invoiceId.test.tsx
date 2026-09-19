import {
  cleanupTestState,
  guardianFactory,
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

  it('shows a credit-note badge for a credit-note invoice', async () => {
    const invoice = { ...invoiceFactory({ id: 'invoice-1' }), kind: 'CREDIT_NOTE' };
    server.use(http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)));

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText('Credit note')).toBeTruthy();
  });

  it('remembers the last chosen print format across a remount', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/invoices/:id/share', () => HttpResponse.json([])),
    );

    const first = renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByText(invoice.invoice_number);
    await user.click(screen.getByRole('radio', { name: 'POS 58mm' }));
    first.unmount();

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const radio = await screen.findByRole('radio', { name: 'POS 58mm' });
    expect(radio.getAttribute('data-state')).toBe('checked');
  });

  it('sends immediately (omitting guardian_id) when the student has exactly one reachable guardian', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', notifications_enabled: true });
    const student = studentFactory({ guardians: [guardian] });
    const invoice = invoiceFactory({ id: 'invoice-1', student, student_id: student.id });
    let sentBody: unknown;
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.post('/api/v1/invoices/:id/send', async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send via WhatsApp' }));

    await waitFor(() => expect(sentBody).toEqual({ medium: 'WHATSAPP' }));
    expect(screen.queryByText('Pick a guardian')).toBeNull();
  });

  it('opens a guardian picker and sends with the chosen guardian_id when there are 2+ reachable guardians', async () => {
    const guardianA = guardianFactory({
      id: 'guardian-a',
      full_name: 'Guardian A',
      notifications_enabled: true,
      is_primary_contact: false,
    });
    const guardianB = guardianFactory({
      id: 'guardian-b',
      full_name: 'Guardian B',
      notifications_enabled: true,
      is_primary_contact: false,
    });
    const student = studentFactory({ guardians: [guardianA, guardianB] });
    const invoice = invoiceFactory({ id: 'invoice-1', student, student_id: student.id });
    let sentBody: unknown;
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.post('/api/v1/invoices/:id/send', async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send via SMS' }));

    const dialog = await screen.findByRole('dialog', { name: 'Choose a guardian' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardian B' }));

    await waitFor(() => expect(sentBody).toEqual({ medium: 'SMS', guardian_id: 'guardian-b' }));
  });

  it('excludes guardians who opted out of notifications from send candidates', async () => {
    const optedOut = guardianFactory({
      id: 'guardian-opted-out',
      notifications_enabled: false,
    });
    const student = studentFactory({ guardians: [optedOut] });
    const invoice = invoiceFactory({ id: 'invoice-1', student, student_id: student.id });
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const button = await screen.findByRole('button', { name: 'Send via WhatsApp' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks the share create → copy → revoke flow', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    let shares: Array<{ id: string; url: string; revoked_at: string | null }> = [];
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/invoices/:id/share', () => HttpResponse.json(shares)),
      http.post('/api/v1/invoices/:id/share', () => {
        shares = [{ id: 'share-1', url: 'https://example.test/i/tok', revoked_at: null }];
        return HttpResponse.json({ id: 'share-1', url: 'https://example.test/i/tok' });
      }),
      http.delete('/api/v1/invoices/:id/share/:tokenId', () => {
        shares = shares.map((share) => ({ ...share, revoked_at: new Date().toISOString() }));
        return HttpResponse.json({});
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create share link' }));

    // "Copy link" appearing (rather than "Create share link") confirms the
    // live share token round-tripped through the query cache after create.
    const copyButton = await screen.findByRole('button', { name: 'Copy link' });
    expect(copyButton).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Revoke this share link?' })).getByRole(
        'button',
        { name: 'Revoke' },
      ),
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Create share link' })).toBeTruthy();
  });

  it('shows the created share URL in a labelled input right after creation', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    let shares: Array<{ id: string; url: string; revoked_at: string | null }> = [];
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/invoices/:id/share', () => HttpResponse.json(shares)),
      http.post('/api/v1/invoices/:id/share', () => {
        shares = [{ id: 'share-1', url: 'https://example.test/i/tok', revoked_at: null }];
        return HttpResponse.json({ id: 'share-1', url: 'https://example.test/i/tok' });
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create share link' }));

    const input = await screen.findByLabelText('Shareable receipt link');
    expect((input as HTMLInputElement).value).toBe('https://example.test/i/tok');
  });

  // The share endpoint (`GET /invoices/:id/share`) only ever returns the
  // stored token *hash*, never the raw URL (`invoices.controller.ts`'s
  // `listTokens`) — so a share that already existed before this page
  // mounted (e.g. after a reload) can never populate the URL input. This
  // used to render an empty, unlabelled `<Input>` instead; the fix is to
  // not pretend the URL is recoverable at all.
  it('hides the URL input for a share that already existed on load, instead of rendering it empty', async () => {
    const invoice = invoiceFactory({ id: 'invoice-1' });
    server.use(
      http.get('/api/v1/invoices/:id', () => HttpResponse.json(invoice)),
      http.get('/api/v1/invoices/:id/share', () =>
        HttpResponse.json([{ id: 'share-1', revoked_at: null }]),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/invoices/invoice-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Revoke' });
    expect(screen.queryByLabelText('Shareable receipt link')).toBeNull();
    expect(
      await screen.findByText(/Link created\. It's only shown right after creation/),
    ).toBeTruthy();
  });
});
