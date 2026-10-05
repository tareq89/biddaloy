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
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The default test RegionConfig is Bangla; pin REGION_BD_EN so assertions read in Latin digits.
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return { ...actual, useRegionConfig: () => actual.REGION_BD_EN };
});

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
    structures: [],
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

    await screen.findByRole('heading', { name: 'Create fee bills' });
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
    expect(screen.getByText('Partly collected')).toBeTruthy();
    // Month name, not the ISO date.
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(screen.queryByText(/2026-09-01/)).toBeNull();
  });

  it('shows the empty state when no batches match', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
      ),
    );

    render();

    expect(await screen.findByText('No fee bills created yet')).toBeTruthy();
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
    await user.click(screen.getByRole('combobox', { name: 'How created' }));
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View bills' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Rahim Uddin')).toBeTruthy();
    expect(dialog.getByRole('heading', { name: 'Billing round — September 2026' })).toBeTruthy();
    expect(dialog.getByText('Monthly tuition · September 2026')).toBeTruthy();
    expect(dialog.getByText('REG-1')).toBeTruthy();
    expect(dialog.getByText('Pending')).toBeTruthy();
  });

  it('forwards every URL filter param to the generations query', async () => {
    let lastQuery = '';
    server.use(
      http.get('/api/v1/fees/generations', ({ request }) => {
        lastQuery = new URL(request.url).search;
        return HttpResponse.json({
          data: [batchFactory()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    render('ADMIN', [
      '/fees/generate?period_from=2026-01-01&period_to=2026-01-31&fee_type=MONTHLY_TUITION&source=MANUAL&generated_by_user_id=user-1&collection_status=PARTIAL',
    ]);

    await screen.findByRole('heading', { name: 'Create fee bills' });
    await waitFor(() => expect(lastQuery).not.toBe(''));

    const params = new URLSearchParams(lastQuery);
    expect(params.get('period_from')).toBe('2026-01-01');
    expect(params.get('period_to')).toBe('2026-01-31');
    expect(params.get('fee_type')).toBe('MONTHLY_TUITION');
    expect(params.get('source')).toBe('MANUAL');
    expect(params.get('generated_by_user_id')).toBe('user-1');
    expect(params.get('collection_status')).toBe('PARTIAL');
  });

  it('sends only page/limit when no filters are set', async () => {
    let lastQuery = '';
    server.use(
      http.get('/api/v1/fees/generations', ({ request }) => {
        lastQuery = new URL(request.url).search;
        return HttpResponse.json({
          data: [batchFactory()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    render();
    await screen.findByRole('heading', { name: 'Create fee bills' });
    await waitFor(() => expect(lastQuery).not.toBe(''));

    const params = new URLSearchParams(lastQuery);
    expect([...params.keys()].sort()).toEqual(['limit', 'page']);
    expect(params.get('limit')).toBe('25');
  });

  it('opening then closing the generate-fees modal refetches the list', async () => {
    let hits = 0;
    server.use(
      http.get('/api/v1/fees/generations', () => {
        hits += 1;
        return HttpResponse.json({
          data: [batchFactory()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    const user = userEvent.setup();
    const { router } = render();
    await screen.findByRole('heading', { name: 'Create fee bills' });
    await waitFor(() => expect(hits).toBeGreaterThan(0));
    const hitsBeforeOpen = hits;

    await user.click(await screen.findByRole('button', { name: 'Create bills' }));
    // The create flow is in the URL (D22).
    await waitFor(() => expect(router.state.location.search).toMatchObject({ generate: 1 }));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(hits).toBeGreaterThan(hitsBeforeOpen));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('generate'));
  });

  it('does not request users or show the Created by filter without USER_READ', async () => {
    let usersRequested = false;
    server.use(
      http.get('/api/v1/users', () => {
        usersRequested = true;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 });
      }),
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [batchFactory()], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );

    render('ACCOUNTANT');

    await screen.findByRole('heading', { name: 'Create fee bills' });
    await screen.findByText('Karim Rahman');
    expect(usersRequested).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'Created by' })).toBeNull();
    // The other filters are still there.
    expect(screen.getByRole('combobox', { name: 'How created' })).toBeTruthy();
  });

  it('closing the bills drawer clears the selected batch', async () => {
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View bills' }));
    await screen.findByText('Rahim Uddin');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText('Rahim Uddin')).toBeNull());
  });

  it('refuses the whole route for a TEACHER, who lacks FEE_GENERATE', async () => {
    server.use(
      http.get('/api/v1/fees/generations', () =>
        HttpResponse.json({ data: [batchFactory()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    render('TEACHER');

    await screen.findByText("You don't have access to this page.");
    expect(screen.queryByText('Create fee bills')).toBeNull();
  });

  it('drops a deep-linked generated_by_user_id when the role cannot read users', async () => {
    let lastQuery = '';
    server.use(
      http.get('/api/v1/fees/generations', ({ request }) => {
        lastQuery = new URL(request.url).search;
        return HttpResponse.json({
          data: [batchFactory()],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }),
    );

    render('ACCOUNTANT', ['/fees/generate?generated_by_user_id=user-1']);

    await screen.findByText('Karim Rahman');
    await waitFor(() =>
      expect(new URLSearchParams(lastQuery).has('generated_by_user_id')).toBe(false),
    );
  });
});
