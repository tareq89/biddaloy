/**
 * [16.6.2] `ReversePaymentDialog` — reason validation, 409
 * `REVERSE_LATER_PAYMENTS_FIRST` rendering, the D9 approval-modal path,
 * and generic-error fallback.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReversePaymentDialog } from './-reverse-payment-dialog';
import type { ReversePaymentDialogProps } from './-reverse-payment-dialog';

afterEach(async () => {
  await cleanupTestState();
});

// `<Link>` (used for the 409 blocking-payments list) needs a router in
// context — same minimal one-route-tree shape `notification-bell.test.tsx`
// uses for the same reason.
async function renderDialog(overrides: Partial<ReversePaymentDialogProps> = {}) {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  function Root() {
    return (
      <ReversePaymentDialog open onOpenChange={onOpenChange} paymentId="payment-1" {...overrides} />
    );
  }
  const rootRoute = createRootRoute({ component: Root });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/payments/payment-1'] }),
    context: { queryClient },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {/* The approval prompt lives in one app-level host (mounted at
            `routes/_staff.tsx` in the real app), so this hand-rolled
            provider stack has to include it too. */}
        <ApprovalModalHostProvider>
          <RouterProvider router={router} />
        </ApprovalModalHostProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

describe('ReversePaymentDialog', () => {
  it('disables the confirm button until a reason is entered', async () => {
    const user = userEvent.setup();
    await renderDialog();

    const confirmButton = await screen.findByRole('button', { name: 'Reverse payment' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    await user.type(await screen.findByLabelText('Reason'), 'Customer paid by mistake');
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
  });

  it('submits the reason and closes on success', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/v1/payments/:id/reverse', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.type(await screen.findByLabelText('Reason'), 'Duplicate payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(capturedBody).toEqual({ reason: 'Duplicate payment' });
  });

  it('renders blocking payment links on a 409 REVERSE_LATER_PAYMENTS_FIRST response', async () => {
    server.use(
      http.post('/api/v1/payments/:id/reverse', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(409, 'Reverse later payments first', '/payments/payment-1/reverse'),
            details: { code: 'REVERSE_LATER_PAYMENTS_FIRST', payment_ids: ['payment-2'] },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    await renderDialog();

    await user.type(await screen.findByLabelText('Reason'), 'Duplicate payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));

    expect(await screen.findByRole('link', { name: 'payment-2' })).toBeTruthy();
  });

  it('shows generic error copy on a non-409 error', async () => {
    server.use(
      http.post('/api/v1/payments/:id/reverse', () =>
        HttpResponse.json(
          apiErrorBody(500, 'Internal Server Error', '/payments/payment-1/reverse'),
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    await renderDialog();

    await user.type(await screen.findByLabelText('Reason'), 'Duplicate payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
  });

  it('opens the approval modal on APPROVAL_REQUIRED, then retries and succeeds', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/payments/:id/reverse', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/payments/payment-1/reverse'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({});
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-1', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.type(await screen.findByLabelText('Reason'), 'Duplicate payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));

    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(attempt).toBe(2);
  });
});
