import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ID = '0b6f0c3e-5b1e-4a53-9a43-2f0d6a0f9d11';
const NEVER_SAY =
  /pending verification|attachment|reference id|approve|decline|callback|gateway|attempt/i;

const RECEIPT = { invoiceId: 'inv-1', receiptNo: 'INV-2026-0042' };

function render(
  status: string,
  unmatched = false,
  locale: 'en' | 'bn' = 'en',
  { receipts = [] as (typeof RECEIPT)[], search = `?id=${ID}`, fail = false } = {},
) {
  server.use(
    http.get(`/api/v1/portal/online-payments/${ID}`, () =>
      fail
        ? HttpResponse.json(
            { statusCode: 500, message: 'x', timestamp: 't', path: 'p', requestId: 'r' },
            { status: 500 },
          )
        : HttpResponse.json({
            id: ID,
            status,
            amount: '2500.00',
            unmatched,
            createdAt: '2026-11-13T04:42:00.000Z',
            receipts,
            paidAt: receipts.length > 0 ? '2026-11-13T04:45:00.000Z' : null,
            bills: [],
          }),
    ),
  );
  renderWithRouter(routeTree, {
    initialEntries: [`/portal/fees/pay/result${search}`],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale,
  });
}

describe('/portal/fees/pay/result', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('COMPLETED says paid with the amount, the receipt number and a receipt button', async () => {
    render('COMPLETED', false, 'en', { receipts: [RECEIPT] });
    expect(await screen.findByText('Payment done')).toBeTruthy();
    expect(screen.getByText('Paid ৳2,500.00. Receipt INV-2026-0042')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View receipt' })).toBeTruthy();
    expect(screen.queryByText(/wallet/)).toBeNull();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('unmatched explains the wallet credit', async () => {
    render('COMPLETED', true, 'en', { receipts: [RECEIPT] });
    expect(await screen.findByText(/went to your wallet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('PENDING uses the glossary words, in both languages', async () => {
    render('PENDING');
    expect(await screen.findByText('Waiting for confirmation')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('PENDING in Bangla says নিশ্চিত করা বাকি', async () => {
    render('PENDING', false, 'bn');
    expect(await screen.findByText('নিশ্চিত করা বাকি')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('COMPLETED in Bangla has no never-say word', async () => {
    render('COMPLETED', true, 'bn', { receipts: [RECEIPT] });
    expect(await screen.findByText(/পরিশোধ হয়েছে। রসিদ INV-2026-0042/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('a missing id says it could not load and offers no retry', async () => {
    render('COMPLETED', false, 'en', { search: '' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a failed load says so and can retry', async () => {
    render('COMPLETED', false, 'en', { fail: true });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it.each(['FAILED', 'CANCELLED', 'EXPIRED'])('%s offers try again and submit proof', async (s) => {
    render(s);
    expect(await screen.findByText('Payment not done')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Submit payment proof' }).getAttribute('href')).toBe(
      '/portal/fees/pay?how=proof',
    );
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('shows Bangla copy', async () => {
    render('FAILED', false, 'bn');
    expect(await screen.findByText('পরিশোধ হয়নি')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });
});
