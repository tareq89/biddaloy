import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const bill = (id: string, name: string, balance: string, waiting = false) => ({
  id,
  name,
  dueDate: '2026-03-10',
  balance,
  waitingSubmission: waiting ? { id: 'sub-1', source: 'PROOF' } : null,
});

const CART = {
  students: [
    {
      studentId: 's1',
      fullName: 'Rahim Uddin',
      bills: [bill('b1', 'April fee', '1200.00'), bill('b2', 'Exam fee', '300.00')],
    },
    { studentId: 's2', fullName: 'Sumi Akter', bills: [bill('b3', 'April fee', '1000.00', true)] },
  ],
};

function render(options: Record<string, unknown> | null = null, submitStatus = 201) {
  const seen = {
    headers: [] as (string | null)[],
    forms: [] as FormData[],
    starts: [] as { body: unknown; key: string | null }[],
  };
  server.use(
    http.get('/api/v1/portal/payment-options', () =>
      HttpResponse.json(
        options ?? {
          onlineEnabled: false,
          proofEnabled: true,
          proofMethods: [{ method: 'BKASH', instructions: 'Send Money to 01711000000' }],
        },
      ),
    ),
    http.post('/api/v1/portal/online-payments', async ({ request }) => {
      seen.starts.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
      if (submitStatus === 503) {
        return HttpResponse.json(
          { statusCode: 503, message: 'x', timestamp: 't', path: 'p', requestId: 'r' },
          { status: 503 },
        );
      }
      return HttpResponse.json({ id: 'o1', bkashUrl: 'https://pay.example/bk' }, { status: 201 });
    }),
    http.get('/api/v1/portal/payment-cart', () => HttpResponse.json(CART)),
    http.post('/api/v1/portal/payment-proofs', async ({ request }) => {
      seen.headers.push(request.headers.get('Idempotency-Key'));
      seen.forms.push(await request.formData());
      if (submitStatus === 503) {
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Proof upload is unavailable, try again later',
            timestamp: '2026-01-01T00:00:00.000Z',
            path: '/api/v1/portal/payment-proofs',
            requestId: 'req-1',
          },
          { status: 503 },
        );
      }
      return HttpResponse.json({ id: 'p1' }, { status: 201 });
    }),
  );
  renderWithRouter(routeTree, {
    initialEntries: ['/portal/fees/pay'],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale: 'en',
  });
  return seen;
}

const submitButton = () => screen.findByRole('button', { name: 'Submit payment proof' });

describe('/portal/fees/pay', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('pre-ticks every open bill, disables a waiting one and totals the ticked ones', async () => {
    render();
    const april = await screen.findByRole('checkbox', { name: /April fee/, checked: true });
    expect(april.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('checkbox', { name: /Exam fee/, checked: true })).toBeTruthy();
    const waiting = screen.getAllByRole('checkbox', { name: /April fee/ })[1];
    expect(waiting?.hasAttribute('disabled')).toBe(true);
    expect(waiting?.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Waiting for confirmation')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('৳1,500.00');
  });

  it('amount follows the selection', async () => {
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /Exam fee/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Amount').value).toBe('৳1,200.00');
  });

  it('shows the school instruction for the method', async () => {
    render();
    expect(await screen.findByText(/Send Money to 01711000000/)).toBeTruthy();
  });

  it('blocks a future date and sends nothing', async () => {
    const seen = render();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Transaction ID (TrxID)'), '8n7a6d5efg');
    await user.type(screen.getByLabelText('When did you pay'), '2999-01-01');
    await user.click(await submitButton());
    expect(await screen.findByText('The date cannot be in the future.')).toBeTruthy();
    expect(seen.forms).toHaveLength(0);
  });

  it('asks for a TrxID or a photo', async () => {
    const seen = render();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('When did you pay'), '2026-03-01');
    await user.click(await submitButton());
    expect(await screen.findByText('Give the transaction ID or add a photo.')).toBeTruthy();
    expect(seen.forms).toHaveLength(0);
  });

  it('submits with an Idempotency-Key, whole-taka amount and only the ticked bills', async () => {
    const seen = render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /Exam fee/ }));
    await user.type(screen.getByLabelText('Transaction ID (TrxID)'), '8N7A6D5EFG');
    await user.type(screen.getByLabelText('When did you pay'), '2026-03-01');
    await user.click(await submitButton());
    await waitFor(() => expect(seen.forms).toHaveLength(1));
    expect(seen.headers[0]).toBeTruthy();
    const form = seen.forms[0]!;
    expect(form.getAll('billIds')).toEqual(['b1']);
    expect(form.get('amount')).toBe('1200');
    expect(form.get('method')).toBe('BKASH');
    expect(form.get('reference')).toBe('8N7A6D5EFG');
    expect(await screen.findByText('Payment proof sent')).toBeTruthy();
  });

  it('says in plain words when proof storage is down', async () => {
    render(null, 503);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Transaction ID (TrxID)'), '8N7A6D5EFG');
    await user.type(screen.getByLabelText('When did you pay'), '2026-03-01');
    await user.click(await submitButton());
    expect(
      await screen.findByText(
        'Proof cannot be saved right now. Please try again in a little while.',
      ),
    ).toBeTruthy();
  });

  it('points to the school office when proof is off', async () => {
    render({ onlineEnabled: false, proofEnabled: false, proofMethods: [] });
    expect(await screen.findByText(/Pay at the school office/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit payment proof' })).toBeNull();
  });

  describe('bKash', () => {
    const both = {
      onlineEnabled: true,
      proofEnabled: true,
      proofMethods: [{ method: 'BKASH', instructions: '' }],
    };
    const payButton = () => screen.findByRole('button', { name: /Pay .*1,500.00.* with bKash/ });

    it('is offered only when online is enabled', async () => {
      render();
      await screen.findByText('Already paid — submit proof');
      expect(screen.queryByText('Pay with bKash')).toBeNull();
    });

    it('is the default and hides the proof form', async () => {
      render(both);
      expect(await screen.findByText('Pay with bKash')).toBeTruthy();
      expect(screen.queryByLabelText('Transaction ID (TrxID)')).toBeNull();
    });

    it('starts with only the ticked bill ids and redirects to the returned URL', async () => {
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      const seen = render(both);
      const user = userEvent.setup();
      await user.click(await payButton());
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.example/bk'));
      expect(seen.starts[0]?.body).toEqual({ billIds: ['b1', 'b2'] });
      expect(seen.starts[0]?.key).toBeTruthy();
      vi.unstubAllGlobals();
    });

    it('503 offers proof instead', async () => {
      const seen = render(both, 503);
      const user = userEvent.setup();
      await user.click(await payButton());
      expect(await screen.findByText(/bKash is not available right now/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Already paid — submit proof' }));
      expect(await screen.findByLabelText('Transaction ID (TrxID)')).toBeTruthy();
      expect(seen.starts).toHaveLength(1);
    });
  });
});
