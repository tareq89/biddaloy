import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [17.3.5/#715] SUPER_ADMIN's platform holiday-sets list. Every case
 * renders SUPER_ADMIN — `_platform.access.test.tsx` already covers the
 * role gate itself.
 */
function renderList() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/holiday-sets'],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });
}

describe('/holiday-sets', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the seeded set with country name, translated source and status, and an edit link', async () => {
    renderList();

    await screen.findByRole('heading', { name: 'Holiday sets' });
    const link = await screen.findByRole('link', { name: /^Edit Bangladesh/ });
    expect(link.getAttribute('href')).toMatch(/^\/holiday-sets\/.+/);
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText(/^Bangladesh/)).toBeTruthy();
    expect(within(row).getByText('Nager.Date (online list)')).toBeTruthy();
    expect(within(row).getByText('Published')).toBeTruthy();
    // No raw ISO code or enum on screen, and a total footer instead of a pager.
    expect(screen.queryByText('NAGER_DATE')).toBeNull();
    expect(screen.queryByRole('link', { name: 'BD' })).toBeNull();
    expect(screen.getByText(/^Total/)).toBeTruthy();
  });

  it('B7: a set returned without entries renders "—" and does not crash', async () => {
    server.use(
      http.get('/api/v1/platform/holiday-sets', () =>
        HttpResponse.json([
          {
            id: 'set-b7',
            country: 'BD',
            year: 2026,
            source: 'NAGER_DATE',
            published_at: null,
            fetched_at: '2026-01-01T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
    );
    renderList();

    const link = await screen.findByRole('link', { name: /^Edit Bangladesh/ });
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('—')).toBeTruthy();
    expect(within(row).getByText('Draft')).toBeTruthy();
  });

  it('surfaces a clear error when fetching a set fails on both sources', async () => {
    server.use(
      http.post('/api/v1/platform/holiday-sets/fetch', () =>
        HttpResponse.json(
          {
            statusCode: 502,
            message: 'Both holiday sources failed.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/platform/holiday-sets/fetch',
            requestId: 'req-1',
          },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderList();

    await screen.findByRole('heading', { name: 'Holiday sets' });
    await user.click(screen.getByRole('button', { name: 'Fetch a set' }));
    await user.type(screen.getByLabelText('Country code'), 'US');
    await user.click(screen.getByRole('button', { name: 'Fetch' }));

    // The translated sentence, never the server's own text.
    await screen.findByText('Could not fetch this set from either source.');
    expect(screen.queryByText('Both holiday sources failed.')).toBeNull();
  });

  it('rejects an invalid country code before calling the API', async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByRole('heading', { name: 'Holiday sets' });
    await user.click(screen.getByRole('button', { name: 'Fetch a set' }));
    await user.click(screen.getByRole('button', { name: 'Fetch' }));

    await waitFor(() => expect(screen.getByText('Enter a 2-letter country code.')).toBeTruthy());
  });
});
