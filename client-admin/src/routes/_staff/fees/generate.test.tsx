/**
 * [16.3.5]'s "Generated fees" log page — real route tree, same reasoning
 * `dues.test.tsx` gives for its own dues-queue tests. The old
 * [8.11.6] wizard flow this route used to render moved to 16.3.6's modal
 * (stubbed here as a local placeholder — see `generate.tsx`'s own
 * `GenerateFeesModal` comment).
 */
import {
  apiErrorBody,
  cleanupTestState,
  renderWithRouter,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function batchFactory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    academic_year_id: 'year-1',
    period_start: '2026-09-01T00:00:00.000Z',
    period_type: 'MONTH',
    due_date: '2026-09-10T00:00:00.000Z',
    source: 'MANUAL',
    duplicate_strategy: 'SKIP',
    notify_families: true,
    student_count: 40,
    generated_count: 38,
    skipped_count: 2,
    removed_count: 0,
    created_at: '2026-09-01T08:00:00.000Z',
    billed_amount: 38000,
    collected_amount: 12000,
    collection_status: 'PARTIAL',
    generated_by: { id: 'user-1', full_name: 'Karim Rahman' },
    ...overrides,
  };
}

function render(role = 'ADMIN', initialEntries = ['/fees/generate']) {
  return renderWithRouter(routeTree, {
    initialEntries,
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/fees/generate', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a row per batch from the mocked API', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [batchFactory()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    render();

    await screen.findByRole('heading', { name: 'Generated fees' });
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
    expect(screen.getByText('Partial')).toBeTruthy();
  });

  it('shows the empty state when no batches match', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
      ),
    );

    render();

    expect(await screen.findByText('No fee generations found')).toBeTruthy();
  });

  it('shows the error state when the batches request fails', async () => {
    // A 4xx, not a 5xx — `shouldRetryQuery` treats a 4xx as non-retryable
    // and gives up immediately, so the error state renders without
    // waiting out the 5xx retry/backoff `dues.test.tsx` doesn't cover
    // either (no test in this app currently exercises a 5xx error state
    // for that same reason).
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json(apiErrorBody(400, 'Bad request', '/api/v1/fees/generations'), {
          status: 400,
        }),
      ),
    );

    render();

    expect(await screen.findByText('Failed to load the generated fees log')).toBeTruthy();
  });

  it('changing a filter updates the URL and refetches', async () => {
    let lastSource: string | null = null;
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          data: [userResponseFactory({ id: 'user-1', full_name: 'Karim Rahman' })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/fees/generations', ({ request }) => {
        lastSource = new URL(request.url).searchParams.get('source');
        return HttpResponse.json({
          data: [batchFactory({ source: lastSource ?? 'MANUAL' })],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    const { router } = render();
    await screen.findByText('Karim Rahman');

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Source' }));
    await user.click(await screen.findByRole('option', { name: 'Manual' }));

    await waitFor(() => expect(lastSource).toBe('MANUAL'));
    expect(router.state.location.search).toMatchObject({ source: 'MANUAL' });
  });

  it('clicking a batch row opens the bills drawer', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [batchFactory()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
      http.get('/api/v1/fees/generations/:id/bills', () =>
        HttpResponse.json({
          data: [
            {
              id: 'bill-1',
              student_id: 'student-1',
              student_full_name: 'Rahim Uddin',
              student_registration_number: 'REG-1',
              class_name: 'Class 9',
              fee_name: 'Monthly tuition',
              amount: 1000,
              paid_amount: 0,
              status: 'PENDING',
              occurrence: '9/2026',
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    render();
    // Region config (independent of the `en` UI locale) defaults to
    // Bengali numerals — same digit set `formatServerAmount` renders
    // elsewhere in this app — so the period button's date reads
    // "২০২৬-০৯-০১", not "2026-09-01".
    const periodButton = await screen.findByRole('button', {
      name: (accessibleName) => accessibleName.includes('২০২৬-০৯-০১'),
    });

    const user = userEvent.setup();
    await user.click(periodButton);

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Monthly tuition (9)')).toBeTruthy();
  });

  it('refuses the whole route for a TEACHER, who lacks FEE_GENERATE', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [batchFactory()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    render('TEACHER');

    await waitFor(() => expect(screen.queryByText('Generated fees')).toBeNull());
  });
});
