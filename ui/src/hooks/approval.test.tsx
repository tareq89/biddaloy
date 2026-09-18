import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { ApprovalCancelledError, useApprovedMutation } from './approval';

afterEach(async () => {
  await cleanupTestState();
});

function approvalRequiredError(): ApiError {
  return new ApiError({
    statusCode: 403,
    message: 'Approval required',
    timestamp: new Date().toISOString(),
    path: '/fees/duplicate',
    requestId: 'req-1',
    details: { code: 'APPROVAL_REQUIRED' },
  });
}

interface HarnessProps {
  mutationFn: (variables: string, options: { headers?: Record<string, string> }) => Promise<string>;
}

function Harness({ mutationFn }: HarnessProps) {
  const approved = useApprovedMutation(mutationFn, { approvalScope: 'fees.duplicate_create' });
  return (
    <div>
      <button onClick={() => approved.mutate('vars')}>run</button>
      {approved.isSuccess && <span data-testid="result">{approved.data}</span>}
      {approved.isError && (
        <span data-testid="error">{String((approved.error as Error).message)}</span>
      )}
    </div>
  );
}

function stepUpHandlers() {
  return [
    http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
    http.post('/api/v1/auth/step-up', () =>
      HttpResponse.json(
        { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
        { status: 201 },
      ),
    ),
  ];
}

/** Same as `Harness`, but with its own testid prefix so two of them can be
 * on screen at once. */
function NamedHarness({ name, mutationFn }: HarnessProps & { name: string }) {
  const approved = useApprovedMutation(mutationFn, { approvalScope: 'fees.duplicate_create' });
  return (
    <div>
      <button onClick={() => approved.mutate('vars')}>{`run-${name}`}</button>
      {approved.isSuccess && <span data-testid={`result-${name}`}>{approved.data}</span>}
      {approved.isError && (
        <span data-testid={`error-${name}`}>{String((approved.error as Error).message)}</span>
      )}
    </div>
  );
}

describe('useApprovedMutation — approval host is not claimed by mount order', () => {
  /**
   * The regression this file exists to pin. The old implementation gave the
   * single `AdminVerificationModal` to whichever hook instance mounted
   * FIRST; the second one rejected with "no modal host mounted" the moment
   * its own mutation hit `APPROVAL_REQUIRED`. That is exactly the shape of
   * the student detail page (an always-mounted `RecordPaymentModal` plus a
   * discounts tab), so the discount-rule approval flow silently broke.
   */
  it('shows the approval prompt for the SECOND-mounted consumer and completes its flow', async () => {
    server.use(...stepUpHandlers());

    const first = vi.fn().mockResolvedValue('first-ok');
    const second = vi
      .fn()
      .mockRejectedValueOnce(approvalRequiredError())
      .mockResolvedValueOnce('second-done');

    const user = userEvent.setup();
    renderWithProviders(
      <>
        <NamedHarness name="checkout" mutationFn={first} />
        <NamedHarness name="discount" mutationFn={second} />
      </>,
      { locale: 'en', tenantId: 'tenant-1' },
    );

    await user.click(screen.getByRole('button', { name: 'run-discount' }));

    // Old behaviour: no dialog at all, and an immediate
    // "no modal host mounted" error on the second consumer.
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('second-done', { selector: '[data-testid="result-discount"]' });
    expect(screen.queryByTestId('error-discount')).toBeNull();
    expect(second).toHaveBeenLastCalledWith('vars', {
      headers: { 'X-Approval-Token': 'tok-123' },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('queues a second approval instead of dropping it, and only ever shows one dialog', async () => {
    server.use(...stepUpHandlers());

    const makeFn = (resolved: string) =>
      vi.fn().mockRejectedValueOnce(approvalRequiredError()).mockResolvedValueOnce(resolved);
    const first = makeFn('first-done');
    const second = makeFn('second-done');

    const user = userEvent.setup();
    renderWithProviders(
      <>
        <NamedHarness name="a" mutationFn={first} />
        <NamedHarness name="b" mutationFn={second} />
      </>,
      { locale: 'en', tenantId: 'tenant-1' },
    );

    await user.click(screen.getByRole('button', { name: 'run-a' }));
    await screen.findByRole('dialog');
    // `fireEvent`, not `user.click`: the open modal makes the rest of the
    // page inert (`aria-hidden` + no pointer events), which is exactly the
    // point — a real user cannot start a second approvable action while a
    // prompt is up. This forces the defensive case anyway.
    fireEvent.click(screen.getByText('run-b'));

    // Both approvals are pending, but an admin only ever sees one prompt.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));

    async function completePrompt() {
      await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
      await user.click(screen.getByRole('button', { name: 'Send code' }));
      await user.type(await screen.findByLabelText('Verification code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify' }));
    }

    await completePrompt();
    await screen.findByText('first-done', { selector: '[data-testid="result-a"]' });

    // The queued one now gets its own prompt rather than being dropped.
    await screen.findByRole('dialog');
    await completePrompt();
    await screen.findByText('second-done', { selector: '[data-testid="result-b"]' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useApprovedMutation', () => {
  it('never opens the modal when the mutation resolves without approval', async () => {
    const mutationFn = vi.fn().mockResolvedValue('ok');
    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByText('ok', { selector: '[data-testid="result"]' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it('opens the modal on APPROVAL_REQUIRED, then retries once with the token header', async () => {
    server.use(
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const mutationFn = vi
      .fn()
      .mockRejectedValueOnce(approvalRequiredError())
      .mockResolvedValueOnce('done');

    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('done', { selector: '[data-testid="result"]' });
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(mutationFn).toHaveBeenLastCalledWith('vars', {
      headers: { 'X-Approval-Token': 'tok-123' },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('surfaces a second APPROVAL_REQUIRED on retry as a normal error, without reopening the modal', async () => {
    server.use(
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const mutationFn = vi
      .fn()
      .mockRejectedValueOnce(approvalRequiredError())
      .mockRejectedValueOnce(approvalRequiredError());

    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });

    await user.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('passes through a non-APPROVAL_REQUIRED rejection unchanged, with no modal', async () => {
    const plainError = new Error('boom, unrelated to approval');
    const mutationFn = vi.fn().mockRejectedValueOnce(plainError);
    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(screen.getByTestId('error').textContent).toContain('boom, unrelated to approval');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it('rejects with ApprovalCancelledError when the admin cancels', async () => {
    const mutationFn = vi.fn().mockRejectedValueOnce(approvalRequiredError());
    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, {
      locale: 'en',
      tenantId: 'tenant-1',
    });

    await user.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(screen.getByTestId('error').textContent).toContain(new ApprovalCancelledError().message);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
