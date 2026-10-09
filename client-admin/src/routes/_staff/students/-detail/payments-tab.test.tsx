import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** The Payments tab, mounted through the real `/students/$studentId` route. */
describe('students/-detail/payments-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function renderPayments(payments: unknown[], role = 'ADMIN') {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
      http.get('/api/v1/payments/student/:studentId', () => HttpResponse.json(payments)),
    );
    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=payments'],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
  }

  const payment = {
    id: 'pay-1',
    payment_date: '2026-03-12',
    total_amount: '500.00',
    payment_method: 'CASH',
    transaction_reference: 'TX-77',
    received_by: { full_name: 'Jane Admin' },
  };

  it('shows a long-form date, a translated method and a view link, never the raw values', async () => {
    renderPayments([payment]);

    const table = await screen.findByRole('region', { name: 'Payments' });
    expect(within(table).getByText('Cash')).toBeTruthy();
    expect(within(table).queryByText('CASH')).toBeNull();
    expect(within(table).queryByText('2026-03-12')).toBeNull();
    const link = within(table).getByRole('link', { name: 'View payment' });
    expect(link.getAttribute('href')).toBe('/payments/pay-1');
  });

  it('record button is outline and opens the full-page record flow for this student', async () => {
    const { router } = renderPayments([payment]);

    const button = await screen.findByRole('button', { name: 'Record payment' });
    expect(button.getAttribute('data-variant')).toBe('outline');
    const user = userEvent.setup();
    await user.click(button);

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toMatchObject({ student_id: 'student-1' });
  });

  it('shows an EmptyState with an explanation when there are no payments', async () => {
    renderPayments([]);

    expect(await screen.findByText('Payments you record will show up here.')).toBeTruthy();
  });
});
