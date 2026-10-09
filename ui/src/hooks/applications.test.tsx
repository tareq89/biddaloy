/**
 * [52.4.1] `applications.ts` — list params + paged shape, pending-count gating,
 * the FEE_WAIVER step-up retry, decision cache writes, letter preview, stepLabel.
 */
import { ApplicationType } from '@biddaloy/shared';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTenantSuspendedError } from '../api/errors';
import { i18n } from '../i18n/i18n';
import { REGION_BD_BN } from '../i18n/region-config';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import {
  applicationKeys,
  downloadApplicationAttachment,
  stepLabel,
  useApplicationLetterPreview,
  useApplicationPendingCount,
  useApplications,
  useApproveApplication,
  useCancelApplication,
  useRejectApplication,
} from './applications';

afterEach(async () => {
  await cleanupTestState();
});

describe('useApplications', () => {
  it('passes view and filters as params and reads data/total from the paged response', async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/applications', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({
          data: [{ id: 'a1' }],
          total: 41,
          page: 2,
          limit: 20,
          totalPages: 3,
        });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useApplications({ view: 'inbox', status: 'PENDING' as never, page: 2, limit: 20 }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toEqual([{ id: 'a1' }]);
    expect(result.current.data?.total).toBe(41);
    expect(query?.get('view')).toBe('inbox');
    expect(query?.get('status')).toBe('PENDING');
    expect(query?.get('page')).toBe('2');
  });
});

describe('useApplicationPendingCount', () => {
  it('does not fetch when disabled', () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/applications/pending-count', () => {
        calls += 1;
        return HttpResponse.json({ total: 5, by_type: [], oldest_pending_at: null });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useApplicationPendingCount({ enabled: false }),
      { tenantId: 'tenant-1' },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(calls).toBe(0);
  });

  it('fetches the total when enabled', async () => {
    server.use(
      http.get('/api/v1/applications/pending-count', () =>
        HttpResponse.json({ total: 5, by_type: [], oldest_pending_at: null }),
      ),
    );

    const { result } = renderHookWithProviders(() => useApplicationPendingCount(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.data?.total).toBe(5));
  });

  it('never rethrows a suspended school 403, even under the app client throwOnError default [15.4.2]', async () => {
    server.use(
      http.get('/api/v1/applications/pending-count', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'This school has been suspended',
            timestamp: new Date().toISOString(),
            path: '/api/v1/applications/pending-count',
            requestId: 'r1',
            details: { code: 'TENANT_SUSPENDED' },
          },
          { status: 403 },
        ),
      ),
    );
    // Same rule `createAppQueryClient()` installs; a throw here would unmount the staff shell.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, throwOnError: isTenantSuspendedError } },
    });

    const { result } = renderHookWithProviders(() => useApplicationPendingCount(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useApplicationLetterPreview', () => {
  const input = { type: 'FEE_WAIVER' as never, payload: { reason: 'x' } };

  it('POSTs the input and returns the server-rendered letter', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/letter-preview', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ letter_text: 'Dear Sir', letter_locale: 'en' });
      }),
    );

    const { result } = renderHookWithProviders(() => useApplicationLetterPreview(input), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.data?.letter_text).toBe('Dear Sir'));
    expect(body).toEqual(input);
  });

  it('is idle when disabled', () => {
    const { result } = renderHookWithProviders(
      () => useApplicationLetterPreview(input, { enabled: false }),
      { tenantId: 'tenant-1' },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('decision mutations', () => {
  it('reject seeds the detail and refreshes lists + badge, not the seeded detail', async () => {
    const dto = { id: 'a1', status: 'REJECTED' };
    server.use(http.post('/api/v1/applications/a1/reject', () => HttpResponse.json(dto)));

    const { result, queryClient } = renderHookWithProviders(() => useRejectApplication(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(applicationKeys.list({}), { data: [] });
    queryClient.setQueryData(applicationKeys.pendingCount(), { total: 1 });
    queryClient.setQueryData(applicationKeys.reports({}), {});

    result.current.mutate({ id: 'a1', reason: 'no' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(applicationKeys.detail('a1'))).toEqual(dto);
    expect(queryClient.getQueryState(applicationKeys.detail('a1'))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(applicationKeys.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(applicationKeys.pendingCount())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(applicationKeys.reports({}))?.isInvalidated).toBe(false);
  });

  it('cancelling a STAFF_LEAVE also refreshes the leave balance (the ledger is reversed)', async () => {
    const dto = { id: 'a1', status: 'CANCELLED', type: 'STAFF_LEAVE' };
    server.use(http.post('/api/v1/applications/a1/cancel', () => HttpResponse.json(dto)));

    const { result, queryClient } = renderHookWithProviders(() => useCancelApplication(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(['leave', 'balance', 'u1'], {});

    result.current.mutate({ id: 'a1', reason: 'no' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(['leave', 'balance', 'u1'])?.isInvalidated).toBe(true);
  });

  function Harness() {
    const approve = useApproveApplication();
    return (
      <div>
        <button onClick={() => approve.mutate({ id: 'a1' })}>approve</button>
        {approve.isSuccess && <span data-testid="result">{approve.data.status}</span>}
      </div>
    );
  }

  it('approve retries once with X-Approval-Token after APPROVAL_REQUIRED', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/applications/a1/approve', ({ request }) => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 403,
              message: 'Approval required',
              timestamp: new Date().toISOString(),
              path: '/applications/a1/approve',
              requestId: 'req-1',
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        expect(request.headers.get('X-Approval-Token')).toBe('tok-123');
        return HttpResponse.json({ id: 'a1', status: 'APPROVED' });
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
    renderWithProviders(<Harness />, { locale: 'en', tenantId: 'tenant-1' });

    await user.click(screen.getByRole('button', { name: 'approve' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('APPROVED', { selector: '[data-testid="result"]' });
    expect(attempt).toBe(2);
  });
});

describe('downloadApplicationAttachment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches through apiClient (auth headers) and saves under the attachment file name', async () => {
    let auth: string | null = null;
    server.use(
      http.get('/api/v1/applications/a1/attachments/f1', ({ request }) => {
        auth = request.headers.get('X-Tenant-ID');
        return new HttpResponse('%PDF', { headers: { 'Content-Type': 'application/pdf' } });
      }),
    );
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let saved: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = this.download;
    });

    renderHookWithProviders(() => null, { tenantId: 'tenant-1' });
    await downloadApplicationAttachment('a1', { id: 'f1', file_name: 'note.pdf' });

    expect(auth).toBe('tenant-1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(saved).toBe('note.pdf');
  });
});

describe('stepLabel', () => {
  it('FEE_WAIVER step 0 reads "ধাপ ১/২ · শ্রেণি শিক্ষক"', async () => {
    await i18n.changeLanguage('bn');
    await i18n.loadNamespaces('applications');
    const t = i18n.getFixedT('bn', 'applications');
    expect(
      stepLabel(
        {
          type: ApplicationType.FEE_WAIVER,
          current_step: 0,
          step_count: 2,
          addressee_name: null,
        },
        t as never,
        REGION_BD_BN,
      ),
    ).toBe('ধাপ ১/২ · শ্রেণি শিক্ষক');
  });
});
