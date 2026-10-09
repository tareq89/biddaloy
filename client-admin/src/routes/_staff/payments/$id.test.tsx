import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function paymentDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    student_id: 'student-1',
    student: { id: 'student-1', full_name: 'Abdul Karim' },
    total_amount: 500,
    payment_method: 'CASH',
    payment_status: 'SUCCESS',
    transaction_reference: null,
    payment_date: '2026-01-05T00:00:00.000Z',
    remarks: null,
    invoice: null,
    received_by: { id: 'user-1', full_name: 'Accountant One' },
    approved_by: null,
    reversal_of_payment_id: null,
    reversed_by_payment_id: null,
    allocations: [],
    created_at: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(role: 'ACCOUNTANT' | 'ADMIN' = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/payments/payment-1'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

const invoice = { id: 'invoice-1', invoice_number: 'INV-2026-000123' };

describe('/payments/$id', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('has no back link; the h1 is the student and the facts include the approver', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () =>
        HttpResponse.json(
          paymentDetail({ approved_by: { id: 'user-2', full_name: 'Admin Two' }, invoice }),
        ),
      ),
    );
    renderDetail();

    expect(
      (await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' })).textContent,
    ).toBe('Abdul Karim');
    expect(screen.queryByText('Back to payments')).toBeNull();
    expect(screen.getByText('Discount approved by')).toBeTruthy();
    expect(screen.getByText('Admin Two')).toBeTruthy();
    expect(screen.getByText('Accountant One')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INV-2026-000123' }).getAttribute('href')).toBe(
      '/invoices/invoice-1',
    );
  });

  it('keeps Reverse payment out of the page body: it is the last More-menu item', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () => HttpResponse.json(paymentDetail({ invoice }))),
    );
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.at(-1)?.textContent).toBe('Reverse payment');
    await user.click(items.at(-1)!);
    expect(await screen.findByText('Reverse this payment?')).toBeTruthy();
  });

  it('shows one primary button, Print receipt, when there is an invoice', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () => HttpResponse.json(paymentDetail({ invoice }))),
    );
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    expect(screen.getAllByRole('button', { name: 'Print receipt' })).toHaveLength(1);
  });

  it('hides Print receipt when there is no invoice', async () => {
    server.use(http.get('/api/v1/payments/:id', () => HttpResponse.json(paymentDetail())));
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    expect(screen.queryByRole('button', { name: 'Print receipt' })).toBeNull();
    expect(screen.getByText('No invoice')).toBeTruthy();
  });

  it('a reversed payment shows the neutral status and links to the reversal entry', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () =>
        HttpResponse.json(paymentDetail({ reversed_by_payment_id: 'payment-2' })),
      ),
    );
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    expect(screen.getByText('This payment has been reversed.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View reversal entry' }).getAttribute('href')).toBe(
      '/payments/payment-2',
    );
    expect(screen.queryByText('payment-2')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Reverse payment' })).toBeNull();
  });

  it('a reversal row links to the original and never offers a reverse', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () =>
        HttpResponse.json(paymentDetail({ reversal_of_payment_id: 'payment-0' })),
      ),
    );
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    expect(screen.getByText('This is a reversal entry.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View original payment' }).getAttribute('href')).toBe(
      '/payments/payment-0',
    );
    expect(screen.queryByText('payment-0')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Reverse payment' })).toBeNull();
  });

  it('closes the reverse dialog when the page moves to another payment', async () => {
    server.use(
      http.get('/api/v1/payments/:id', ({ params }) =>
        HttpResponse.json(paymentDetail({ id: params.id })),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reverse payment' }));
    await screen.findByText('Reverse this payment?');

    await router.navigate({ to: '/payments/$id', params: { id: 'payment-2' } });

    await waitFor(() => expect(screen.queryByText('Reverse this payment?')).toBeNull());
  });

  it('shows remarks and the allocation total', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () =>
        HttpResponse.json(
          paymentDetail({
            remarks: 'Paid at the counter',
            allocations: [
              {
                id: 'a1',
                student_fee_id: 'f1',
                allocated_amount: 300,
                allocation_type: 'DUE',
                discount_amount: 0,
                fee_name: 'Tuition',
                period_start: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
        ),
      ),
    );
    renderDetail('ACCOUNTANT');

    expect(await screen.findByText('Paid at the counter')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Where the money went' })).toBeTruthy();
    expect(screen.getByText(`Total ${formatNumber(1, REGION_BD_BN)}`)).toBeTruthy();
  });

  it('shows an error state with retry when the payment fails to load', async () => {
    let attempts = 0;
    server.use(
      http.get('/api/v1/payments/:id', () => {
        attempts += 1;
        return HttpResponse.json(
          {
            statusCode: 500,
            message: 'boom',
            requestId: 'r1',
            path: '/payments/payment-1',
            timestamp: new Date().toISOString(),
          },
          { status: 500 },
        );
      }),
    );
    renderDetail('ACCOUNTANT');

    expect(await screen.findByText("Couldn't load this payment.")).toBeTruthy();
    expect(attempts).toBeGreaterThan(0);
  });
});
