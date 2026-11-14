import { cleanupTestState, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { MyProofsTab } from './-my-proofs-tab';

const ME = 'user-me';
const OTHER = 'user-other';

function proof(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    status: 'PENDING',
    method: 'BKASH',
    amount: '500.00',
    paidOn: '2026-03-10',
    reference: 'TRX123',
    submittedByUserId: ME,
    createdAt: '2026-03-10T08:00:00.000Z',
    rejectReason: null,
    rejectNote: null,
    discardReason: null,
    bills: [{ studentFeeId: 'f1', studentId: 's1', amount: '500.00' }],
    files: [],
    ...over,
  };
}

function mock(proofs: unknown[]) {
  const withdrawn: string[] = [];
  server.use(
    http.get('/api/v1/users/me', () => HttpResponse.json({ id: ME, full_name: 'Me' })),
    http.get('/api/v1/students/mine', () =>
      HttpResponse.json([studentFactory({ id: 's1', full_name: 'Fatima Rahman' })]),
    ),
    http.get('/api/v1/portal/payment-proofs', () => HttpResponse.json(proofs)),
    http.post('/api/v1/portal/payment-proofs/:id/withdraw', ({ params }) => {
      withdrawn.push(params.id as string);
      return HttpResponse.json(proof({ id: params.id, status: 'WITHDRAWN' }));
    }),
  );
  return withdrawn;
}

/** [3.x/#3975] The guardian's "My payment proofs" tab. */
describe('MyProofsTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state when there are no proofs', async () => {
    mock([]);
    renderPortalCard(<MyProofsTab />);
    expect(await screen.findByText('No payment proofs yet')).toBeTruthy();
  });

  it('renders each status with the glossary words, the student, amount and TrxID', async () => {
    mock([
      proof({ id: 'a', status: 'PENDING' }),
      proof({ id: 'b', status: 'CONFIRMED' }),
      proof({ id: 'c', status: 'REJECTED', rejectReason: 'IMAGE_UNCLEAR', rejectNote: 'Blurry' }),
      proof({ id: 'd', status: 'DISCARDED' }),
      proof({ id: 'e', status: 'WITHDRAWN' }),
    ]);
    renderPortalCard(<MyProofsTab />);
    const cards = await screen.findAllByTestId('proof-card');
    expect(cards).toHaveLength(5);
    expect(within(cards[0]!).getByText('Waiting for confirmation')).toBeTruthy();
    expect(within(cards[0]!).getByText('Fatima Rahman')).toBeTruthy();
    expect(within(cards[0]!).getByText('TRX123')).toBeTruthy();
    expect(within(cards[1]!).getByText('Confirmed')).toBeTruthy();
    expect(within(cards[2]!).getByText('Rejected')).toBeTruthy();
    expect(within(cards[2]!).getByText(/Image unclear/)).toBeTruthy();
    expect(within(cards[2]!).getByText(/Blurry/)).toBeTruthy();
    expect(within(cards[3]!).getByText('Discarded — already paid')).toBeTruthy();
    expect(within(cards[3]!).getByText('Bill already paid — submit again next month')).toBeTruthy();
    expect(within(cards[4]!).getByText('Withdrawn')).toBeTruthy();
  });

  it('a co-guardian row with no reason shows the badge and no reason line', async () => {
    mock([proof({ status: 'REJECTED', submittedByUserId: OTHER })]);
    renderPortalCard(<MyProofsTab />);
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(screen.queryByText(/Reason/)).toBeNull();
  });

  it('withdraw is offered only on your own waiting proof', async () => {
    mock([
      proof({ id: 'mine-pending' }),
      proof({ id: 'mine-confirmed', status: 'CONFIRMED' }),
      proof({ id: 'theirs-pending', submittedByUserId: OTHER }),
    ]);
    renderPortalCard(<MyProofsTab />);
    await screen.findAllByTestId('proof-card');
    // Wait for the current user: the button only appears once the id is known.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1),
    );
    const cards = screen.getAllByTestId('proof-card');
    expect(within(cards[0]!).getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(within(cards[1]!).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(within(cards[2]!).queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('withdraw asks first, then posts once', async () => {
    const withdrawn = mock([proof({ id: 'mine-pending' })]);
    renderPortalCard(<MyProofsTab />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    expect(withdrawn).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawn).toEqual(['mine-pending']));
  });
});
