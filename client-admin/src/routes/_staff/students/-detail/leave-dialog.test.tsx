import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LeaveDialog } from './leave-dialog';

function withBalance(balance: number) {
  return http.get('/api/v1/payments/invoices/student/:id', () =>
    HttpResponse.json({
      student_id: 's1',
      student_name: 'Karim',
      summary: { total_due: balance, total_paid: 0, total_discount: 0, balance },
      fee_breakdown: [],
      payments: [],
    }),
  );
}

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="open-leave" onClick={() => setOpen(true)} />
      <LeaveDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        studentId="s1"
        studentName="Karim"
      />
    </>
  );
}

async function openDialog() {
  const view = renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en' });
  await view.localeReady;
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('open-leave'));
  await screen.findByRole('dialog');
  return user;
}

describe('LeaveDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('requires a reason', async () => {
    server.use(withBalance(0));
    const user = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Record leaving' }));
    expect(await screen.findByText('Write a reason.')).toBeTruthy();
  });

  it('blocks a future date', async () => {
    server.use(withBalance(0));
    const post = vi.fn();
    server.use(
      http.post('/api/v1/students/s1/leave', () => {
        post();
        return HttpResponse.json({});
      }),
    );
    const user = await openDialog();
    await user.type(screen.getByLabelText('Reason'), 'Moved away');
    const date = screen.getByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2999-01-01');
    await user.click(screen.getByRole('button', { name: 'Record leaving' }));
    expect(await screen.findByText('The date cannot be in the future.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the dues warning and still submits', async () => {
    server.use(
      withBalance(500),
      http.post('/api/v1/students/s1/leave', () =>
        HttpResponse.json({ id: 'e1' }, { status: 201 }),
      ),
    );
    const onOpenChange = vi.fn();
    const view = renderWithProviders(<Harness onOpenChange={onOpenChange} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await view.localeReady;
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('open-leave'));
    expect(await screen.findByText(/unpaid dues/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Record leaving' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.type(screen.getByLabelText('Reason'), 'Moved away');
    await user.click(submit);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows destination only for a transfer', async () => {
    server.use(withBalance(0));
    const user = await openDialog();
    expect(screen.queryByLabelText('New school')).toBeNull();
    await user.click(screen.getByLabelText('Reason type'));
    await user.click(await screen.findByRole('option', { name: 'Transferred to another school' }));
    expect(screen.getByLabelText('New school')).toBeTruthy();
  });

  it('submits on Ctrl+Enter', async () => {
    const body = vi.fn();
    server.use(
      withBalance(0),
      http.post('/api/v1/students/s1/leave', async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({ id: 'e1' }, { status: 201 });
      }),
    );
    const user = await openDialog();
    await user.type(screen.getByLabelText('Reason'), 'Moved away');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() =>
      expect(body).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'WITHDRAWN', reason: 'Moved away' }),
      ),
    );
  });

  // ponytail: Radix Dialog restores focus to the opener natively; jsdom
  // does not reproduce that reliably, so only focus-in and Escape-close
  // are asserted here.
  it('moves focus into the dialog, closes on Escape, and is axe clean', async () => {
    server.use(withBalance(0));
    const user = await openDialog();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await expect(document.body).toHaveNoViolations();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
