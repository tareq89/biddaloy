import type { StudentFee } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WriteOffBillDialog } from './write-off-bill-dialog';

// Money columns are strings on the wire (Postgres decimal), same as fees-tab.test.tsx.
const bill = {
  id: 'bill-1',
  fee_structure: { id: 's1', name: 'Tuition' },
  period_start: '2026-03-01T00:00:00.000Z',
  total_amount: '100.00',
  paid_amount: '0.00',
  discount_amount: '0.00',
} as unknown as StudentFee;

function approvalRequired() {
  return HttpResponse.json(
    {
      statusCode: 403,
      message: 'Approval required',
      timestamp: new Date().toISOString(),
      path: '/fees/bills/bill-1/waive',
      requestId: 'req-1',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
}

async function renderDialog() {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <WriteOffBillDialog open onOpenChange={onOpenChange} bill={bill} />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { onOpenChange };
}

describe('WriteOffBillDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the bill and keeps Write off disabled until a reason is typed', async () => {
    const user = userEvent.setup();
    await renderDialog();

    expect(await screen.findByText(/Tuition · .+ · Owes/)).toBeTruthy();
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Write off' });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'ab');
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'c');
    expect(confirm.disabled).toBe(false);
  });

  it('blocks a partial amount above the outstanding balance', async () => {
    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Write off part of it' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount to write off' }), '150');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Hardship');

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Write off' }).disabled).toBe(
      true,
    );
  });

  it('full write-off: steps up, then posts only the reason and closes', async () => {
    let calls = 0;
    let body: unknown;
    server.use(
      http.post('/api/v1/fees/bills/bill-1/waive', async ({ request }) => {
        calls += 1;
        if (calls === 1) return approvalRequired();
        body = await request.json();
        return HttpResponse.json({ id: 'bill-1', amount: 100, status: 'WAIVED' });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Hardship case');
    await user.click(screen.getByRole('button', { name: 'Write off' }));
    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ reason: 'Hardship case' });
  });

  it('partial write-off sends the typed amount', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/fees/bills/bill-1/waive', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'bill-1', amount: 40, status: 'PARTIALLY_PAID' });
      }),
    );
    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Write off part of it' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount to write off' }), '40');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Part forgiven');
    await user.click(screen.getByRole('button', { name: 'Write off' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ amount: 40, reason: 'Part forgiven' });
  });

  it('shows an alert when the server refuses', async () => {
    server.use(
      http.post('/api/v1/fees/bills/bill-1/waive', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    await renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Hardship case');
    await user.click(screen.getByRole('button', { name: 'Write off' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't write off");
  });
});
