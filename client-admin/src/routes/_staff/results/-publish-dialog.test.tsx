/**
 * [19.8.1] `PublishDialog` (a plain write) and `ReopenPreviewDialog`
 * (step-up approval-gated). The reopen suite's whole point is UX
 * ordering: the impact preview must already be on screen, visible,
 * before the approval modal ever appears — same hand-rolled provider
 * stack as `grading-scales/-recompute-preview-dialog.test.tsx`.
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
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishDialog, ReopenPreviewDialog } from './-publish-dialog';

afterEach(async () => {
  await cleanupTestState();
});

async function renderWithProviders(children: React.ReactNode) {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();

  function Root() {
    return <>{children}</>;
  }
  const rootRoute = createRootRoute({ component: Root });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/exams/exam-1'] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ApprovalModalHostProvider>
          <RouterProvider router={router} />
        </ApprovalModalHostProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('PublishDialog', () => {
  it('shows the count of results being published', async () => {
    const onOpenChange = vi.fn();
    await renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={42} />,
    );

    expect(
      await screen.findByText('42 student result(s) become visible to guardians.'),
    ).toBeTruthy();
  });

  it('publishes directly — no approval gate on this endpoint', async () => {
    let called = false;
    server.use(
      http.post('/api/v1/exams/exam-1/results/publish', () => {
        called = true;
        return HttpResponse.json({ published: true });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={5} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(called).toBe(true);
  });
});

describe('ReopenPreviewDialog', () => {
  it('renders the impact preview before any approval modal appears', async () => {
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={vi.fn()} examId="exam-1" resultCount={12} />,
    );

    expect(
      await screen.findByText(
        '12 published result(s) will be unpublished and marks become editable again. This needs step-up approval.',
      ),
    ).toBeTruthy();
    // The approval modal's own field must NOT be on screen yet — it only
    // appears after Confirm is clicked and the server returns 403.
    expect(screen.queryByLabelText('Email or phone')).toBeNull();
  });

  it('opens the step-up approval modal only after Confirm is clicked, then reopens on success', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/exams/exam-1/results/reopen', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/exams/exam-1/results/reopen'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({ reopened: true });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json({ token: 'tok-1' }, { status: 201 }),
      ),
    );

    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={12} />,
    );

    // Preview visible before the first click.
    await screen.findByText(
      '12 published result(s) will be unpublished and marks become editable again. This needs step-up approval.',
    );
    expect(screen.queryByLabelText('Email or phone')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    // Only now does the approval modal appear.
    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(attempt).toBe(2);
  });
});
