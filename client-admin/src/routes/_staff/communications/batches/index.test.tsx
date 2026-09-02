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
import { screen } from '@testing-library/react';
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
});
