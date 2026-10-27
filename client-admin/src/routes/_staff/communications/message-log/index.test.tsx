/**
 * [87.SD] `/communications/message-log` — the message log the dashboard's Failed
 * messages / SMS balance widgets open. Real route tree, MSW-backed.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function render(path: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/communications/message-log', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('passes the widget filters to the API and lists the failed message with its reason', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/communications/logs', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({
          data: [
            {
              id: 'log-1',
              medium: 'SMS',
              recipient_address: '01712345678',
              recipient_name: 'Karim Uddin',
              status: 'FAILED',
              student_id: 's-1',
              guardian_id: 'g-1',
              provider_message_id: null,
              error: 'NO_PROVIDER',
              created_at: '2026-10-20T09:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }),
    );
    render('/communications/message-log?medium=SMS&status=FAILED');

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(query?.get('status')).toBe('FAILED');
      expect(query?.get('medium')).toBe('SMS');
    });
  });

  it('shows the empty state', async () => {
    server.use(
      http.get('/api/v1/communications/logs', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );
    render('/communications/message-log');
    expect(await screen.findByText('No messages found.')).toBeTruthy();
  });
});
