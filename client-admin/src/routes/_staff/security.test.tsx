import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

function renderSecurityPage() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/security'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const SESSIONS_RESPONSE = {
  data: [
    {
      id: 'session-current',
      started_at: '2026-08-01T09:00:00.000Z',
      last_used_at: '2026-09-07T04:00:00.000Z',
      user_agent: 'Chrome/128.0.0.0 Windows',
      ip_address: '203.0.113.5',
      current: true,
    },
    {
      id: 'session-other',
      started_at: '2026-07-15T09:00:00.000Z',
      last_used_at: '2026-09-01T12:00:00.000Z',
      user_agent: null,
      ip_address: null,
      current: false,
    },
  ],
};

describe('/security', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the heading and both sessions', async () => {
    server.use(http.get('/api/v1/auth/sessions', () => HttpResponse.json(SESSIONS_RESPONSE)));

    renderSecurityPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Active sessions' })).toBeTruthy();
    expect(await screen.findByText('This device')).toBeTruthy();
    expect(screen.getByText('Unknown device')).toBeTruthy();
  });

  it('revokes a non-current session and refreshes the list', async () => {
    let deleted = false;
    server.use(
      http.get('/api/v1/auth/sessions', () =>
        HttpResponse.json(deleted ? { data: [SESSIONS_RESPONSE.data[0]] } : SESSIONS_RESPONSE),
      ),
      http.delete('/api/v1/auth/sessions/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderSecurityPage();

    await screen.findByText('Unknown device');
    await user.click(screen.getByRole('button', { name: /Sign out — Unknown device/ }));

    await waitFor(() => expect(screen.queryByText('Unknown device')).toBeNull());
  });

  it('renders an error state when the list fails to load', async () => {
    server.use(http.get('/api/v1/auth/sessions', () => HttpResponse.json({}, { status: 500 })));

    renderSecurityPage();

    expect(await screen.findByText("Couldn't load your sessions. Please try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
