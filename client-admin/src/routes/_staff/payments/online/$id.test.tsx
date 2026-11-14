/**
 * `/payments/online/$id` — the proof review screen ([3.4.x]) over the real route tree.
 */
import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 'proof-1',
    source: 'PROOF',
    status: 'PENDING',
    method: 'BKASH',
    amount: '2500.00',
    paidOn: '2026-11-13',
    reference: '8N7A6D5EFG',
    createdAt: '2026-11-13T04:42:00.000Z',
    guardian: { userId: 'user-g1', name: 'Rahima Begum', phone: '+8801711000001' },
    rejectReason: null,
    rejectNote: null,
    discardReason: null,
    duplicateFlag: null,
    billAlreadyPaid: false,
    bills: [
      {
        studentFeeId: 'f1',
        studentId: 'student-1',
        studentName: 'Arif Hossain',
        amount: '2500.00',
        paymentId: null,
      },
    ],
    files: [],
    events: [
      {
        fromStatus: null,
        toStatus: 'PENDING',
        actorUserId: 'user-g1',
        reasonCode: null,
        note: null,
        createdAt: '2026-11-13T04:42:00.000Z',
      },
    ],
    next_pending_id: 'proof-2',
    ...over,
  };
}

function render(id = 'proof-1') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/payments/online/${id}`],
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

function mockDetail(body: Record<string, unknown>, id = 'proof-1') {
  server.use(
    http.get(`/api/v1/payment-submissions/${id}`, () => HttpResponse.json(body)),
    http.get('/api/v1/students/student-1', () =>
      HttpResponse.json(
        studentFactory({
          id: 'student-1',
          guardians: [
            { id: 'guardian-row-1', user_id: 'user-g1', full_name: 'Rahima Begum' },
          ] as never,
        }),
      ),
    ),
  );
}

describe('/payments/online/$id', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the proof, the Call link as tel:, and Send SMS to the guardian', async () => {
    mockDetail(detail());
    render();

    expect(await screen.findByText('8N7A6D5EFG')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Call Rahima Begum/ }).getAttribute('href')).toBe(
      'tel:+8801711000001',
    );
    const sms = await screen.findByRole('link', { name: 'Send SMS' });
    expect(sms.getAttribute('href')).toContain('to=guardian%3Aguardian-row-1');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm & next' })),
    );
  });

  it('shows the duplicate flag and the bill-already-paid warning', async () => {
    mockDetail(detail({ duplicateFlag: 'DUPLICATE_PENDING', billAlreadyPaid: true }));
    render();

    expect(await screen.findByText(/also waiting/)).toBeTruthy();
    expect(screen.getByText(/already paid/)).toBeTruthy();
  });

  it('Confirm & next confirms once, then opens the next proof', async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    let key: string | null = null;
    mockDetail(detail());
    mockDetail(detail({ id: 'proof-2', reference: 'NEXTTRX', next_pending_id: null }), 'proof-2');
    server.use(
      http.post('/api/v1/payment-submissions/proof-1/confirm', ({ request }) => {
        confirmed += 1;
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          outcome: 'SETTLED',
          paymentIds: ['pay-1'],
          detail: detail({ status: 'CONFIRMED' }),
        });
      }),
    );
    render();

    await user.click(await screen.findByRole('button', { name: 'Confirm & next' }));

    expect(await screen.findByText('NEXTTRX')).toBeTruthy();
    expect(confirmed).toBe(1);
    expect(key).toBeTruthy();
  });

  it('Reject needs a reason, and "Other" needs a note', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    mockDetail(detail({ next_pending_id: null }));
    server.use(
      http.post('/api/v1/payment-submissions/proof-1/reject', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(detail({ status: 'REJECTED', next_pending_id: null }));
      }),
    );
    render();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject this payment proof' });
    const submit = within(dialog).getByRole('button', { name: 'Reject' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(dialog).getByRole('combobox', { name: 'Reason' }));
    await user.click(await screen.findByRole('option', { name: 'Other' }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByLabelText(/Note/), 'Photo is of another bill');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    await waitFor(() =>
      expect(body).toEqual({ reason: 'OTHER', note: 'Photo is of another bill' }),
    );
  });

  it('links a confirmed proof to the payment so it can be reversed', async () => {
    mockDetail(
      detail({
        status: 'CONFIRMED',
        bills: [
          {
            studentFeeId: 'f1',
            studentId: 'student-1',
            studentName: 'Arif Hossain',
            amount: '2500.00',
            paymentId: 'pay-1',
          },
        ],
      }),
    );
    render();

    const link = await screen.findByRole('link', { name: 'Reverse this payment' });
    expect(link.getAttribute('href')).toBe('/payments/pay-1');
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  });
});
