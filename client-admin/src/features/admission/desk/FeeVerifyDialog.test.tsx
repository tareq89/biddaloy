import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeeVerifyDialog, type FeeProofRow } from './FeeVerifyDialog';

afterEach(async () => {
  await cleanupTestState();
  vi.restoreAllMocks();
});

const proof = (seen: number): FeeProofRow => ({
  id: 'p1',
  applicant_id: 'a1',
  intake_id: 'r1',
  applicant_name: 'Rahim',
  applicant_reference_number: 'ADM-1',
  applicant_status: 'FEE_PENDING',
  method: 'BKASH',
  reference: 'TX9',
  state: 'AWAITING',
  reason: null,
  created_at: '2027-01-01T00:00:00Z',
  seen_before: seen,
  amount_paisa: 50000,
});

function setup(seen = 0, onClose = vi.fn()) {
  server.use(
    http.get('/api/v1/admission/fee-proofs/p1/attachment', () =>
      HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
        headers: { 'Content-Type': 'image/png' },
      }),
    ),
  );
  const create = vi.fn(() => 'blob:fee-1');
  const revoke = vi.fn();
  // jsdom has neither; each test file runs in its own environment.
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const tree = createRootRoute({
    component: () => <FeeVerifyDialog proof={proof(seen)} amountPaisa={50000} onClose={onClose} />,
  });
  const view = renderWithRouter(tree, {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return { onClose, revoke, view };
}

describe('FeeVerifyDialog', () => {
  it('Send back stays off until a reason is written, and the reason is capped at 300', async () => {
    setup();
    const sendBack = await screen.findByRole('button', { name: 'Send back' });
    expect((sendBack as HTMLButtonElement).disabled).toBe(true);
    const reason = screen.getByLabelText<HTMLTextAreaElement>(/Reason/);
    expect(reason.maxLength).toBe(300);
    await userEvent.type(reason, 'blurred');
    expect((sendBack as HTMLButtonElement).disabled).toBe(false);
  });

  it('Fee is ok posts confirm and closes', async () => {
    let hit = 0;
    const { onClose } = setup();
    server.use(
      http.post('/api/v1/admission/fee-proofs/p1/confirm', () => {
        hit += 1;
        return HttpResponse.json({ id: 'p1', state: 'CONFIRMED' });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Fee is ok' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hit).toBe(1);
  });

  it('Send back posts the reason', async () => {
    let body: unknown;
    const { onClose } = setup();
    server.use(
      http.post('/api/v1/admission/fee-proofs/p1/send-back', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'p1', state: 'SENT_BACK' });
      }),
    );
    await userEvent.type(await screen.findByLabelText(/Reason/), ' not clear ');
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body).toEqual({ reason: 'not clear' });
  });

  it('warns only when the reference was seen before', async () => {
    setup(2);
    expect(await screen.findByText(/used before/)).toBeTruthy();
  });

  it('shows no warning for a new reference', async () => {
    setup(0);
    await screen.findByRole('button', { name: 'Fee is ok' });
    expect(screen.queryByText(/used before/)).toBeNull();
  });

  it('revokes the object URL on close', async () => {
    const { revoke, view } = setup();
    await screen.findByAltText('Fee proof');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:fee-1');
  });
});
