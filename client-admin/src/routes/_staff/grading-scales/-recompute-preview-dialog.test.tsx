/**
 * [20.3.1] `RecomputePreviewDialog` — the affected-count copy renders
 * before any approval step, and confirming drives the approval-gated
 * `useConfirmBands` mutation (`useApprovedMutation`'s step-up modal on a
 * `403 APPROVAL_REQUIRED`). Same hand-rolled provider stack as
 * `payments/-reverse-payment-dialog.test.tsx`.
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
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RecomputePreviewDialog,
  type RecomputePreviewDialogProps,
} from './-recompute-preview-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const BANDS = [
  {
    percent_from: 80,
    percent_to: 100,
    grade: 'A+',
    gpa: 5,
    is_fail: false,
    sequence: 1,
    comment: null,
  },
];

async function renderDialog(overrides: Partial<RecomputePreviewDialogProps> = {}) {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  const onConfirmed = vi.fn();

  function Root() {
    return (
      <RecomputePreviewDialog
        open
        onOpenChange={onOpenChange}
        scaleId="scale-1"
        bands={BANDS}
        affectedResultCount={3}
        onConfirmed={onConfirmed}
        {...overrides}
      />
    );
  }

  const rootRoute = createRootRoute({ component: Root });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/grading-scales/scale-1'] }),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ApprovalModalHostProvider>
          <RouterProvider router={router} />
        </ApprovalModalHostProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenChange, onConfirmed };
}

describe('RecomputePreviewDialog', () => {
  it('renders the affected-result count before any approval modal opens', async () => {
    await renderDialog({ affectedResultCount: 3 });

    expect(
      await screen.findByText("3 students' results will be recalculated against the new bands."),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Email or phone')).toBeNull();
  });

  it('confirms directly through the approval-gated mutation when no step-up is required', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/v1/grading/scales/:id/bands/confirm', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ scale: {}, affected_result_count: 3 });
      }),
    );

    const user = userEvent.setup();
    const { onConfirmed } = await renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(capturedBody).toEqual({ bands: BANDS });
  });

  it('opens the approval step-up modal on 403 APPROVAL_REQUIRED, then retries and confirms', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/grading/scales/:id/bands/confirm', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/grading/scales/scale-1/bands/confirm'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({ scale: {}, affected_result_count: 3 });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json({ token: 'tok-1' }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    const { onConfirmed } = await renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(attempt).toBe(2);
  });

  it('refuses to be dismissed while the confirm is in flight, then still fires onConfirmed', async () => {
    // Regression: `$scaleId.tsx` unmounts this dialog on close, and
    // unmounting drops the per-call `onSuccess`. A dismissal landing while
    // the confirm was in flight (the step-up modal opening over this one
    // and taking an interaction Radix attributed to this layer) meant the
    // 201 arrived with nobody listening — the dialog reopened, stuck.
    server.use(
      http.post('/api/v1/grading/scales/:id/bands/confirm', async () => {
        await delay(300);
        return HttpResponse.json({ scale: {}, affected_result_count: 3 });
      }),
    );

    const user = userEvent.setup();
    const { onOpenChange, onConfirmed } = await renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await user.keyboard('{Escape}'); // in flight: must be a no-op
    expect(onOpenChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled(), { timeout: 3000 });

    await user.keyboard('{Escape}'); // settled: dismissal works again
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
