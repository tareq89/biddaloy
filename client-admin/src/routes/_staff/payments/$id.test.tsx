import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
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

describe('/payments/$id', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the student, amount, status and collector', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () => HttpResponse.json(paymentDetail())),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/payments/payment-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText('Abdul Karim')).toBeTruthy();
    expect(screen.getByText('Accountant One')).toBeTruthy();
  });

  it('shows a reversed banner and hides the reverse button once already reversed', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () =>
        HttpResponse.json(paymentDetail({ reversed_by_payment_id: 'payment-2' })),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/payments/payment-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Abdul Karim');
    expect(screen.getByText('This payment has been reversed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
  });

  it('opens the reverse dialog from the detail page', async () => {
    server.use(
      http.get('/api/v1/payments/:id', () => HttpResponse.json(paymentDetail())),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/payments/payment-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));
    expect(await screen.findByText('Reverse this payment?')).toBeTruthy();
  });

  it('shows an error state with retry when the payment fails to load', async () => {
    let attempts = 0;
    server.use(
      http.get('/api/v1/payments/:id', () => {
        attempts += 1;
        return HttpResponse.json(
          { statusCode: 500, message: 'boom', requestId: 'r1', path: '/payments/payment-1', timestamp: new Date().toISOString() },
          { status: 500 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/payments/payment-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText("Couldn't load this payment.")).toBeTruthy();
    expect(attempts).toBeGreaterThan(0);
  });
});
