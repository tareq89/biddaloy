/**
 * [8.11.9]'s Reminder History list — real route tree, MSW-backed. The
 * page itself is a thin `ListShell` over `GET /reminder/bulk`; what's
 * worth pinning is the row content (name links to detail, counts,
 * `StatusBadge domain="reminderBatch"`), the empty/error states, and
 * the role gate.
 */
import {
  cleanupTestState,
  communicationHandlers,
  errorHandler,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function render(role = 'ACCOUNTANT') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/batches'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/communications/batches', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists batches with status badges and links each name to its detail page', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({
          data: [
            {
              id: 'batch-1',
              batch_name: 'August dues reminder',
              status: 'PARTIALLY_FAILED',
              total_recipients: 50,
              successful_count: 48,
              failed_count: 2,
              created_at: '2026-08-20T09:00:00.000Z',
            },
            {
              id: 'batch-2',
              batch_name: 'July dues reminder',
              status: 'PROCESSING',
              total_recipients: 10,
              successful_count: 0,
              failed_count: 0,
              created_at: '2026-07-20T09:00:00.000Z',
            },
          ],
          total: 2,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
    );
    render();

    const link = await screen.findByRole<HTMLAnchorElement>('link', {
      name: 'August dues reminder',
    });
    expect(link.getAttribute('href')).toBe('/communications/batches/batch-1');
    // Status text comes from `StatusBadge domain="reminderBatch"`.
    expect(screen.getByText('Partially failed')).toBeTruthy();
    expect(screen.getByText('Processing')).toBeTruthy();
    // Counts render as their own columns.
    expect(screen.getByText('48')).toBeTruthy();
  });

  it('shows the empty state when no batches exist yet', async () => {
    server.use(communicationHandlers.listBulkRemindersEmpty);
    render();

    expect(await screen.findByText('No reminder batches yet.')).toBeTruthy();
  });

  it('shows the error state when the list cannot load', async () => {
    // 404 rather than 500: `shouldRetryQuery` retries 5xx twice with
    // backoff, which only slows the test without changing the UI state.
    server.use(errorHandler('get', '/api/v1/communications/reminder/bulk', 404));
    render();

    expect(await screen.findByText('Could not load reminder batches.')).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot view reminder history" text.
  it('refuses a TEACHER with the forbidden explanation', async () => {
    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is axe clean with rows on screen', async () => {
    const { container } = render();

    await screen.findByRole('link', { name: 'August dues reminder' });
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — typing into the search field writes
  // `search` to the URL and forwards it to the request.
  it('typing in the search box writes search to the URL and the request', async () => {
    let lastSearch: string | null = null;
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        lastSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Reminder batches' });
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'August');

    await waitFor(() => expect(lastSearch).toBe('August'), { timeout: 1000 });
    expect(router.state.location.search).toMatchObject({ search: 'August' });
  });

  // [8.14.10]: the Status filter is a real FilterBar `select`, not a
  // hand-rolled one — picking a value writes `status` to the URL/request.
  it('picking a status filters the request', async () => {
    let lastStatus: string | null = null;
    server.use(
      http.get('/api/v1/communications/reminder/bulk', ({ request }) => {
        lastStatus = new URL(request.url).searchParams.get('status');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    render();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Reminder batches' });
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Completed' }));

    await waitFor(() => expect(lastStatus).toBe('COMPLETED'));
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({ data: [], total: 0, page: 2, limit: 20, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/communications/batches?page=2'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Reminder batches' });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale — same reasoning
    // `invoices/index.test.tsx` documents for its own page-size test.
    await user.click(await screen.findByRole('option', { name: '৫০' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 50, page: 1 }));
  });

  // [8.14.10]: `sorting`/`onSortingChange` used to be wired but never
  // reflected in the actual query — clicking a sortable header now
  // threads `sort`/`order` through to the request.
  it('clicking the Name column header writes sort/order to the URL', async () => {
    server.use(
      http.get('/api/v1/communications/reminder/bulk', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Reminder batches' });
    await user.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ sort: 'name', order: 'desc' }),
    );
  });
});
