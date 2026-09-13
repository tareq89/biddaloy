import { screen, waitFor } from '@testing-library/react';
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
      {approved.isError && <span data-testid="error">{String((approved.error as Error).message)}</span>}
      {approved.modal}
    </div>
  );
}

describe('useApprovedMutation', () => {
  it('never opens the modal when the mutation resolves without approval', async () => {
    const mutationFn = vi.fn().mockResolvedValue('ok');
    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, { locale: 'en', tenantId: 'tenant-1' });

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
    renderWithProviders(<Harness mutationFn={mutationFn} />, { locale: 'en', tenantId: 'tenant-1' });

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
    renderWithProviders(<Harness mutationFn={mutationFn} />, { locale: 'en', tenantId: 'tenant-1' });

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

  it('rejects with ApprovalCancelledError when the admin cancels', async () => {
    const mutationFn = vi.fn().mockRejectedValueOnce(approvalRequiredError());
    const user = userEvent.setup();
    renderWithProviders(<Harness mutationFn={mutationFn} />, { locale: 'en', tenantId: 'tenant-1' });

    await user.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(screen.getByTestId('error').textContent).toContain(new ApprovalCancelledError().message);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
