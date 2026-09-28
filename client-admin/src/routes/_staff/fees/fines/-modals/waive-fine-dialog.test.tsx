import { cleanupTestState, fineFactory, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WaiveFineDialog } from './waive-fine-dialog';

function approvalRequiredBody() {
  return HttpResponse.json(
    {
      statusCode: 403,
      message: 'Approval required',
      timestamp: new Date().toISOString(),
      path: '/fees/fines/fine-1/waive',
      requestId: 'req-1',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );
}

async function renderDialog(props: { fineId?: string; studentId?: string }) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <WaiveFineDialog open onOpenChange={onOpenChange} {...props} />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { ...view, onOpenChange };
}

describe('WaiveFineDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('blocks a partial amount greater than the outstanding balance', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      total_amount: 100,
      paid_amount: 0,
      discount_amount: 0,
    });
    server.use(
      http.get('/api/v1/fees/fines', () =>
        HttpResponse.json({ items: [fine], total: 1, totals: {} }),
      ),
    );

    const user = userEvent.setup();
    await renderDialog({ fineId: 'fine-1' });

    await user.click(await screen.findByRole('radio', { name: 'Waive part of it' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount to waive' }), '৳150');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Overcharged');

    const confirmButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Waive fine' });
    expect(confirmButton.disabled).toBe(true);
  });

  it('retries after a 403 APPROVAL_REQUIRED with a step-up token', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      total_amount: 100,
      paid_amount: 0,
      discount_amount: 0,
    });
    server.use(
      http.get('/api/v1/fees/fines', () =>
        HttpResponse.json({ items: [fine], total: 1, totals: {} }),
      ),
    );

    let waiveCalls = 0;
    server.use(
      http.post('/api/v1/fees/fines/:id/waive', () => {
        waiveCalls += 1;
        if (waiveCalls === 1) return approvalRequiredBody();
        return HttpResponse.json({ id: 'fine-1', amount: 100, status: 'WAIVED' }, { status: 201 });
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
    await renderDialog({ fineId: 'fine-1' });

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Waiving in full');
    await user.click(screen.getByRole('button', { name: 'Waive fine' }));

    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(waiveCalls).toBe(2));
  });

  it("lists a student-only selection's open fines in a select", async () => {
    const openFine = fineFactory({
      id: 'fine-1',
      status: 'PENDING',
      total_amount: 100,
      paid_amount: 0,
      discount_amount: 0,
    });
    const paidFine = fineFactory({ id: 'fine-2', status: 'PAID' });
    server.use(
      http.get('/api/v1/fees/fines', () =>
        HttpResponse.json({ items: [openFine, paidFine], total: 2, totals: {} }),
      ),
    );

    await renderDialog({ studentId: 'student-1' });

    const select = await screen.findByRole('combobox', { name: 'Fine' });
    expect(select).toBeTruthy();
  });
});
