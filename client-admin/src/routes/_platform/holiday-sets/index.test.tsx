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

  it('lists the seeded holiday set with its country, year and published state', async () => {
    renderList();

    await screen.findByRole('heading', { name: 'Holiday sets' });
    const link = await screen.findByRole('link', { name: 'BD' });
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('2026')).toBeTruthy();
    expect(within(row).getByText('Published')).toBeTruthy();
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
    await user.type(screen.getByLabelText('Country (ISO alpha-2, e.g. BD)'), 'US');
    await user.click(screen.getByRole('button', { name: 'Fetch' }));

    await screen.findByText('Both holiday sources failed.');
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
