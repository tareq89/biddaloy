/**
 * [8.11.9]'s batch detail — the two behaviors that earn their tests:
 *
 * 1. **Polling stops when the batch settles.** The AC is "polling runs
 *    only while the batch is in progress"; with fake timers we count
 *    requests: PROCESSING schedules one more poll, COMPLETED schedules
 *    none.
 * 2. **Retry composes the exact expected body** — the failed students
 *    only (walked from every page of the FAILED logs, deduped), the
 *    batch's own stored template, and a "Retry of …" name — then lands
 *    on the new batch.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const STUDENT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const STUDENT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const STUDENT_C = 'cccccccc-0000-0000-0000-000000000003';

function batchBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    batch_name: 'August dues reminder',
    status: 'PARTIALLY_FAILED',
    total_recipients: 3,
    successful_count: 1,
    failed_count: 2,
    message_template: 'Dear {{guardian_name}}, dues are open.',
    created_at: '2026-08-20T09:00:00.000Z',
    skipped: [
      { student_id: STUDENT_C, guardian_id: null, reason: 'no_guardians' },
      { student_id: STUDENT_B, guardian_id: null, reason: 'no_guardians' },
    ],
    ...overrides,
  };
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    medium: 'SMS',
    recipient_address: '+8801700000000',
    recipient_name: 'Guardian One',
    status: 'SENT',
    student_id: STUDENT_A,
    guardian_id: 'guardian-1',
    provider_message_id: 'pm-1',
    error: null,
    created_at: '2026-08-20T09:00:05.000Z',
    ...overrides,
  };
}

function render(role = 'ACCOUNTANT') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/batches/batch-1'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/communications/batches/$batchId', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('shows header counts, per-recipient logs with errors, and grouped skipped reasons', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () => HttpResponse.json(batchBody())),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [
            logRow(),
            logRow({
              id: 'log-2',
              recipient_name: 'Guardian Two',
              status: 'FAILED',
              student_id: STUDENT_B,
              error: 'Provider rejected the number',
            }),
          ],
          total: 2,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    );
    render();

    expect(await screen.findByRole('heading', { name: 'August dues reminder' })).toBeTruthy();
    expect(screen.getByText('Partially failed')).toBeTruthy();
    // Per-recipient rows, including the FAILED one's error — "FAILED" is
    // never unexplained.
    expect(await screen.findByText('Guardian Two')).toBeTruthy();
    expect(screen.getByText('Provider rejected the number')).toBeTruthy();
    // Skipped grouped by reason with a count, not a UUID list.
    expect(screen.getByText(/No guardians on file — 2 students/)).toBeTruthy();
  });

  it('polls while PROCESSING and stops once the batch settles', async () => {
    // `shouldAdvanceTime` keeps real async work (MSW responses, React
    // Query settling) flowing while still letting the test jump the
    // 3-second poll interval deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () => {
        calls += 1;
        return HttpResponse.json(
          batchBody(
            calls < 2
              ? { status: 'PROCESSING', successful_count: 0, failed_count: 0 }
              : { status: 'COMPLETED', successful_count: 3, failed_count: 0 },
          ),
        );
      }),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
    );
    render();

    await screen.findByRole('heading', { name: 'August dues reminder' });
    expect(calls).toBe(1);
    expect(screen.getByText('Processing')).toBeTruthy();

    // PROCESSING scheduled exactly one more poll.
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeTruthy();
    });
    expect(calls).toBe(2);

    // Settled: no further polls, no matter how long we wait.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(2);
  });

  it('retries only the failed students, as a fresh "Retry of …" batch, and navigates to it', async () => {
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', ({ params }) =>
        HttpResponse.json(
          params['id'] === 'batch-retry-1'
            ? batchBody({
                id: 'batch-retry-1',
                batch_name: 'Retry of August dues reminder',
                status: 'PROCESSING',
                skipped: [],
              })
            : batchBody(),
        ),
      ),
      // Two pages of logs, so the retry provably walks past page one.
      // STUDENT_A appears FAILED twice (two guardians) — deduped to one.
      http.get('/api/v1/communications/reminder/bulk/:id/logs', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        return HttpResponse.json(
          page === '2'
            ? {
                data: [
                  logRow({ id: 'log-3', status: 'FAILED', student_id: STUDENT_B }),
                  logRow({ id: 'log-4', status: 'FAILED', student_id: STUDENT_A }),
                ],
                total: 4,
                page: 2,
                limit: 100,
                totalPages: 2,
              }
            : {
                data: [
                  logRow({ id: 'log-1', status: 'FAILED', student_id: STUDENT_A }),
                  logRow({ id: 'log-2', status: 'SENT', student_id: STUDENT_C }),
                ],
                total: 4,
                page: 1,
                limit: 100,
                totalPages: 2,
              },
        );
      }),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          batchBody({
            id: 'batch-retry-1',
            batch_name: 'Retry of August dues reminder',
            status: 'PROCESSING',
            skipped: [],
          }),
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Retry failed' }));
    // The confirm dialog restates the new batch's name before anything posts.
    expect(await screen.findByText(/Retry of August dues reminder/)).toBeTruthy();
    expect(sentBody).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(sentBody).toEqual({
        student_ids: [STUDENT_A, STUDENT_B],
        message_template: 'Dear {{guardian_name}}, dues are open.',
        batch_name: 'Retry of August dues reminder',
      });
    });
    // Landed on the new batch's own detail page.
    expect(
      await screen.findByRole('heading', { name: 'Retry of August dues reminder' }),
    ).toBeTruthy();
  });

  // Business-critical: a retry that drops the batch's own targeting sends to
  // guardians the original deliberately excluded, and turns a WhatsApp
  // template send into freeform text Meta rejects — reproducing the failure.
  it('replays the batch channels and approved template on retry', async () => {
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () =>
        HttpResponse.json(
          batchBody({
            mediums: ['EMAIL'],
            whatsapp_template_name: 'fee_reminder',
            whatsapp_template_language: 'bn',
            whatsapp_template_params: ['guardian_name'],
          }),
        ),
      ),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [logRow({ id: 'log-1', status: 'FAILED', student_id: STUDENT_A })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(batchBody({ id: 'batch-retry-1', skipped: [] }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Retry failed' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(sentBody).toMatchObject({
        mediums: ['EMAIL'],
        whatsapp_template_name: 'fee_reminder',
        whatsapp_template_language: 'bn',
        whatsapp_template_params: ['guardian_name'],
      });
    });
  });

  // The endpoint targets students, not guardians, so a guardian whose message
  // already arrived is messaged again. The sender is told before confirming.
  it('warns that every guardian of the failed students is messaged again', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () => HttpResponse.json(batchBody())),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [logRow({ id: 'log-1', status: 'FAILED', student_id: STUDENT_A })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Retry failed' }));

    expect(
      await screen.findByText(/including any whose earlier message was delivered/i),
    ).toBeTruthy();
  });

  // batch_name is capped at 200 server-side; an unmodified prefix on a
  // near-cap name would come back as a bare 400.
  it('keeps the retry name within the server cap for a near-cap batch name', async () => {
    const longName = 'A'.repeat(198);
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () =>
        HttpResponse.json(batchBody({ batch_name: longName })),
      ),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [logRow({ id: 'log-1', status: 'FAILED', student_id: STUDENT_A })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(batchBody({ id: 'batch-retry-1', skipped: [] }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Retry failed' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(sentBody).toBeDefined());
    expect((sentBody?.['batch_name'] as string).length).toBeLessThanOrEqual(200);
  });

  // The header used to flip to a settled status above a table still showing
  // its first page of QUEUED rows, which made "Retry failed" look like a no-op.
  it('reconciles the per-recipient table once the batch settles', async () => {
    let batchCalls = 0;
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () => {
        batchCalls += 1;
        return HttpResponse.json(
          batchBody({
            status: batchCalls === 1 ? 'PROCESSING' : 'PARTIALLY_FAILED',
            successful_count: batchCalls === 1 ? 0 : 1,
            failed_count: batchCalls === 1 ? 0 : 1,
          }),
        );
      }),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [
            logRow({
              id: 'log-1',
              status: batchCalls <= 1 ? 'QUEUED' : 'FAILED',
              error: batchCalls <= 1 ? null : 'Gateway rejected the number',
              student_id: STUDENT_A,
            }),
          ],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
    render();

    expect(await screen.findByText('Queued')).toBeTruthy();
    // Once the batch settles, the table refetches rather than staying frozen.
    expect(
      await screen.findByText('Gateway rejected the number', undefined, { timeout: 10000 }),
    ).toBeTruthy();
  });

  it('offers no retry while the batch is still PROCESSING', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () =>
        HttpResponse.json(batchBody({ status: 'PROCESSING' })),
      ),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
    );
    render();

    await screen.findByRole('heading', { name: 'August dues reminder' });
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot view reminder history" text.
  it('refuses a TEACHER with the forbidden explanation', async () => {
    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
  });

  it('is axe clean with logs and skipped on screen', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk/:id', () => HttpResponse.json(batchBody())),
      http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
        HttpResponse.json({
          data: [logRow()],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    );
    const { container } = render();

    await screen.findByRole('heading', { name: 'August dues reminder' });
    await screen.findByText('Guardian One');
    await expect(container).toHaveNoViolations();
  });
});
