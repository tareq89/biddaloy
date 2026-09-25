/**
 * [26.7.1] `CommitDialog` — a presentational dialog; a small harness wires
 * its `onConfirm` to the real `useCommitPromotionRun` hook (same
 * hand-rolled provider stack as `results/-publish-dialog.test.tsx`) so the
 * step-up approval assertion below exercises the real 403
 * `APPROVAL_REQUIRED` → modal flow, not a mock.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { ApprovalModalHostProvider, useCommitPromotionRun } from '@biddaloy/ui/hooks';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CommitDialog, type PromotionRunCounts } from './-commit-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const COUNTS: PromotionRunCounts = { promoted: 20, retained: 3, graduated: 5 };

function Harness({
  hasPlacementErrors = false,
  hasUnnotedOverrides = false,
}: {
  hasPlacementErrors?: boolean;
  hasUnnotedOverrides?: boolean;
}) {
  const commitRun = useCommitPromotionRun('run-1');
  return (
    <CommitDialog
      open
      onOpenChange={() => {}}
      counts={COUNTS}
      hasPlacementErrors={hasPlacementErrors}
      hasUnnotedOverrides={hasUnnotedOverrides}
      confirming={commitRun.isPending}
      onConfirm={() => commitRun.mutate()}
    />
  );
}

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
    history: createMemoryHistory({ initialEntries: ['/promotions/run-1'] }),
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

describe('CommitDialog', () => {
  it('renders the promoted/retained/graduated counts', async () => {
    await renderWithProviders(<Harness />);
    await screen.findByText('20 promoted, 3 retained, 5 graduated. This cannot be undone.');
  });

  it('disables Commit while a row has a placement error', async () => {
    await renderWithProviders(<Harness hasPlacementErrors />);
    const commitButton = await screen.findByRole('button', { name: 'Commit' });
    expect(commitButton.hasAttribute('disabled')).toBe(true);
    screen.getByText('Fix every placement error before committing.');
  });

  it('disables Commit while an override has no note', async () => {
    await renderWithProviders(<Harness hasUnnotedOverrides />);
    const commitButton = await screen.findByRole('button', { name: 'Commit' });
    expect(commitButton.hasAttribute('disabled')).toBe(true);
    screen.getByText('Every override needs a note before committing.');
  });

  it('commits directly, no approval prompt, when there are no overrides', async () => {
    server.use(http.post('/api/v1/promotions/run-1/commit', () => HttpResponse.json({ id: 'run-1' })));
    const user = userEvent.setup();
    await renderWithProviders(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Commit' }));

    expect(screen.queryByLabelText('Email or phone')).toBeNull();
  });

  it('shows the step-up approval modal when the server demands it (overrides present)', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/promotions/run-1/commit', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/promotions/run-1/commit'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({ id: 'run-1' });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json({ token: 'tok-1' }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    await renderWithProviders(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Commit' }));

    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(attempt).toBe(2);
  });
});
