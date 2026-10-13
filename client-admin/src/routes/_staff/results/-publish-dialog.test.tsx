/**
 * [19.8.1] `PublishDialog` (a plain write) and `ReopenPreviewDialog`
 * (step-up approval-gated). The reopen suite's whole point is UX
 * ordering: the impact preview must already be on screen, visible,
 * before the approval modal ever appears — same hand-rolled provider
 * stack as `grading-scales/-recompute-preview-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { I18nProvider, REGION_BD_BN, i18n } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublishDialog, ReopenPreviewDialog } from './-publish-dialog';

beforeEach(() => mockRegister());

afterEach(async () => {
  await cleanupTestState();
});

function certRow(n: number, kind = 'RESULT_CERTIFICATE') {
  return {
    item_id: `item-${n}`,
    document_kind: kind,
    serial: `RES-2026-0000${n}`,
    serial_year: 2026,
    serial_no: n,
    subject_id: `stu-${n}`,
    subject_label: `Student ${n}`,
    issued_at: '2026-03-01T00:00:00.000Z',
    status: 'VALID',
  };
}

/** The reopen dialog reads the exam's live certificates; most tests have none.
 * Honours `document_kind` and `page` (100 per page) like the real register. */
function mockRegister(rows: Array<{ document_kind: string }> = []) {
  server.use(
    http.get('/api/v1/print-history/register', ({ request }) => {
      const url = new URL(request.url);
      const kind = url.searchParams.get('document_kind');
      const page = Number(url.searchParams.get('page') ?? '1');
      const matching = rows.filter((r) => !kind || r.document_kind === kind);
      return HttpResponse.json({
        data: matching.slice((page - 1) * 100, page * 100),
        total: matching.length,
        page,
        limit: 100,
        totalPages: Math.max(1, Math.ceil(matching.length / 100)),
      });
    }),
  );
}

/** Confirm stays disabled until the certificate list has loaded. */
async function enabledButton(name: string | RegExp) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  return button;
}

async function renderWithProviders(children: React.ReactNode, role = 'ADMIN') {
  setActiveTenant('tenant-1');
  setActiveRole(role);
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
      await screen.findByText(
        `${formatNumber(42, REGION_BD_BN)} student result(s) become visible to guardians.`,
      ),
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
  it('shows an error message when publishing fails, and keeps the dialog open', async () => {
    server.use(
      http.post('/api/v1/exams/exam-1/results/publish', () =>
        HttpResponse.json(
          apiErrorBody(409, 'Results are not processed', '/exams/exam-1/results/publish'),
          { status: 409 },
        ),
      ),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={5} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByText("Couldn't publish these results.")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clears the previous error when the dialog is cancelled', async () => {
    server.use(
      http.post('/api/v1/exams/exam-1/results/publish', () =>
        HttpResponse.json(
          apiErrorBody(409, 'Results are not processed', '/exams/exam-1/results/publish'),
          { status: 409 },
        ),
      ),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={5} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await screen.findByText("Couldn't publish these results.");

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // `open` is still true here (the parent owns it), so the dialog stays
    // mounted — proving the error line is gone because of `reset()`.
    await waitFor(() => expect(screen.queryByText("Couldn't publish these results.")).toBeNull());
  });

  it('ignores Cancel while the publish request is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/exams/exam-1/results/publish', async () => {
        await gate;
        return HttpResponse.json({ published: true });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={5} />,
    );

    const publishButton = await screen.findByRole('button', { name: 'Publish' });
    await user.click(publishButton);
    await waitFor(() => expect(publishButton.getAttribute('aria-busy')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    // Once the request finishes, the success handler closes the dialog.
    release();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('ReopenPreviewDialog', () => {
  it('renders the impact preview before any approval modal appears', async () => {
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={vi.fn()} examId="exam-1" resultCount={12} />,
    );

    expect(
      await screen.findByText(
        `${formatNumber(12, REGION_BD_BN)} published result(s) will be unpublished and marks become editable again. This needs extra approval.`,
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
      `${formatNumber(12, REGION_BD_BN)} published result(s) will be unpublished and marks become editable again. This needs extra approval.`,
    );
    expect(screen.queryByLabelText('Email or phone')).toBeNull();

    await user.click(await enabledButton('Reopen'));

    // Only now does the approval modal appear.
    await screen.findByLabelText('Email or phone');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(attempt).toBe(2);
  });

  it('shows an error message when reopening fails for a reason other than approval', async () => {
    server.use(
      http.post('/api/v1/exams/exam-1/results/reopen', () =>
        HttpResponse.json(
          apiErrorBody(409, 'Results are not published', '/exams/exam-1/results/reopen'),
          { status: 409 },
        ),
      ),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={3} />,
    );

    await user.click(await enabledButton('Reopen'));

    expect(await screen.findByText("Couldn't reopen this exam.")).toBeTruthy();
    // A plain 409 never opens the approval modal.
    expect(screen.queryByLabelText('Email or phone')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Cancelling closes the dialog and wipes the stale error.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByText("Couldn't reopen this exam.")).toBeNull());
  });

  it('ignores Cancel while the reopen request is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/exams/exam-1/results/reopen', async () => {
        await gate;
        return HttpResponse.json({ reopened: true });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={3} />,
    );

    const reopenButton = await enabledButton('Reopen');
    await user.click(reopenButton);
    await waitFor(() => expect(reopenButton.getAttribute('aria-busy')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('ReopenPreviewDialog certificates (ACAD-12)', () => {
  function mockReopenAndRevoke() {
    const revoked: Array<{ id: string; reason: string }> = [];
    let reopened = 0;
    server.use(
      http.post('/api/v1/exams/exam-1/results/reopen', () => {
        reopened += 1;
        return HttpResponse.json({ reopened: true });
      }),
      http.post('/api/v1/print-history/items/:id/revoke', async ({ params, request }) => {
        const body = (await request.json()) as { reason: string };
        revoked.push({ id: String(params.id), reason: body.reason });
        return HttpResponse.json({ item_id: params.id, revoked_at: '2026-04-01T00:00:00.000Z' });
      }),
    );
    return { revoked, reopenCount: () => reopened };
  }

  it('lists both live certificates checked; confirm reopens then revokes both with the reason', async () => {
    mockRegister([certRow(1), certRow(2, 'MERIT_CERTIFICATE')]);
    const { revoked, reopenCount } = mockReopenAndRevoke();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={2} />,
    );

    expect(await screen.findByText('RES-2026-00001')).toBeTruthy();
    expect(screen.getByText('RES-2026-00002')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);

    await user.click(screen.getByRole('button', { name: /Reopen and revoke/ }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(reopenCount()).toBe(1);
    expect(revoked.map((r) => r.id).sort()).toEqual(['item-1', 'item-2']);
    expect(revoked.every((r) => r.reason === 'Result reopened for correction')).toBe(true);
  });

  it('unchecking one revokes only the other', async () => {
    mockRegister([certRow(1), certRow(2)]);
    const { revoked } = mockReopenAndRevoke();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={2} />,
    );

    await screen.findByText('RES-2026-00001');
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /Reopen and revoke/ }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(revoked.map((r) => r.id)).toEqual(['item-2']);
  });

  it('without DOCUMENT_REVOKE the list is read-only and nothing is revoked', async () => {
    // EXECUTIVE holds no DOCUMENT_REVOKE (ADMIN only).
    mockRegister([certRow(1)]);
    const { revoked, reopenCount } = mockReopenAndRevoke();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={1} />,
      'EXECUTIVE',
    );

    expect(await screen.findByText('RES-2026-00001')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(
      screen.getByText('Ask an admin to revoke these from the certificate register'),
    ).toBeTruthy();
    await user.click(await enabledButton('Reopen'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(reopenCount()).toBe(1);
    expect(revoked).toHaveLength(0);
  });

  it('an empty register shows no list', async () => {
    mockRegister([]);
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={vi.fn()} examId="exam-1" resultCount={2} />,
    );
    await screen.findByRole('button', { name: 'Reopen' });
    expect(screen.queryByText('Certificates already issued for this exam')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('lists and revokes every certificate, past the first page of 100', async () => {
    mockRegister([
      ...Array.from({ length: 101 }, (_, i) => certRow(i + 1)),
      certRow(500, 'MERIT_CERTIFICATE'),
    ]);
    const { revoked } = mockReopenAndRevoke();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={102} />,
    );

    await user.click(await enabledButton(/Reopen and revoke/));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(revoked).toHaveLength(102);
  });

  it('Confirm is disabled until the certificate list has loaded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/print-history/register', async () => {
        await gate;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 });
      }),
    );
    const { reopenCount } = mockReopenAndRevoke();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={vi.fn()} examId="exam-1" resultCount={1} />,
    );

    const button = await screen.findByRole('button', { name: 'Reopen' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await user.click(button);
    expect(reopenCount()).toBe(0);
    release();
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });

  it('a register that fails to load shows a warning and still lets the reopen go ahead', async () => {
    server.use(
      http.get('/api/v1/print-history/register', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/print-history/register'), {
          status: 403,
        }),
      ),
    );
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={vi.fn()} examId="exam-1" resultCount={1} />,
    );
    expect(
      await screen.findByText(
        "Couldn't load the certificates issued for this exam. Check the certificate register after reopening.",
      ),
    ).toBeTruthy();
    await enabledButton('Reopen');
  });

  it('a second Reopen after a full success reopens again (no stale state)', async () => {
    mockRegister([certRow(1)]);
    const { reopenCount } = mockReopenAndRevoke();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    // The parent keeps the dialog mounted between the two reopens.
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={1} />,
    );

    await user.click(await enabledButton(/Reopen and revoke/));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(reopenCount()).toBe(1);

    await user.click(await enabledButton(/Reopen and revoke/));
    await waitFor(() => expect(reopenCount()).toBe(2));
  });

  it('a failed revoke keeps the dialog open and names the serial; reopen already succeeded', async () => {
    mockRegister([certRow(1)]);
    server.use(
      http.post('/api/v1/exams/exam-1/results/reopen', () => HttpResponse.json({ reopened: true })),
      http.post('/api/v1/print-history/items/:id/revoke', () =>
        HttpResponse.json(apiErrorBody(409, 'already revoked', '/x'), { status: 409 }),
      ),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ReopenPreviewDialog open onOpenChange={onOpenChange} examId="exam-1" resultCount={1} />,
    );
    await user.click(await screen.findByRole('button', { name: /Reopen and revoke/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('RES-2026-00001');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
