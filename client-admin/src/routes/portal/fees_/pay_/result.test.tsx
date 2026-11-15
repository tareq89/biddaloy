import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ID = '0b6f0c3e-5b1e-4a53-9a43-2f0d6a0f9d11';
const NEVER_SAY =
  /pending verification|attachment|reference id|approve|decline|callback|gateway|attempt/i;

function render(status: string, unmatched = false, locale: 'en' | 'bn' = 'en') {
  server.use(
    http.get(`/api/v1/portal/online-payments/${ID}`, () =>
      HttpResponse.json({
        id: ID,
        status,
        amount: '2500.00',
        unmatched,
        createdAt: '2026-11-13T04:42:00.000Z',
        bills: [],
      }),
    ),
  );
  renderWithRouter(routeTree, {
    initialEntries: [`/portal/fees/pay/result?id=${ID}`],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale,
  });
}

describe('/portal/fees/pay/result', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('COMPLETED says paid with the amount and a receipt link', async () => {
    render('COMPLETED');
    expect(await screen.findByText('Payment done')).toBeTruthy();
    expect(screen.getByText('৳2,500.00')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View receipt' })).toBeTruthy();
    expect(screen.queryByText(/wallet/)).toBeNull();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('unmatched explains the wallet credit', async () => {
    render('COMPLETED', true);
    expect(await screen.findByText(/went to your wallet/)).toBeTruthy();
  });

  it('PENDING says confirming', async () => {
    render('PENDING');
    expect(await screen.findByText('Confirming, please wait')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it.each(['FAILED', 'CANCELLED', 'EXPIRED'])('%s offers try again and submit proof', async (s) => {
    render(s);
    expect(await screen.findByText('Payment not done')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Submit payment proof' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('shows Bangla copy', async () => {
    render('FAILED', false, 'bn');
    expect(await screen.findByText('পরিশোধ হয়নি')).toBeTruthy();
  });
});
