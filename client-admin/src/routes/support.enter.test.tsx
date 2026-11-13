import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

const CODE = 'one-time-code-VALUE-123';

function fakeJwt(): string {
  const payload = btoa(
    JSON.stringify({
      exp: 9_999_999_999,
      memberships: [{ tenantId: 't-1', role: 'ADMIN', name: 'Greenview' }],
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
}

describe('/support/enter', () => {
  afterEach(async () => {
    window.history.replaceState(null, '', '/');
    sessionStorage.clear();
    await cleanupTestState();
  });

  it('shows one fixed sentence and a close link for a reused or expired code', async () => {
    window.history.replaceState(null, '', `/support/enter#code=${CODE}`);
    server.use(
      http.post('/api/v1/auth/impersonation/exchange', () =>
        HttpResponse.json({ statusCode: 401, message: 'x', requestId: 'r' }, { status: 401 }),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/support/enter'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('This link cannot be used')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Close this tab' })).toBeTruthy();
    expect(window.location.href).not.toContain(CODE);
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('exchanges once and leaves the tab without a refresh call', async () => {
    window.history.replaceState(null, '', `/support/enter#code=${CODE}`);
    const token = fakeJwt();
    server.use(
      http.post('/api/v1/auth/impersonation/exchange', () =>
        HttpResponse.json({
          access_token: token,
          sessionId: 's-1',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ),
      http.get('/api/v1/auth/impersonation/me', () => HttpResponse.json({ role: 'ADMIN' })),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/support/enter'],
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/support/enter'));
    expect(sessionStorage.getItem('biddaloy:supportTab')).toContain(token);
    expect(localStorage.getItem('biddaloy:supportTab')).toBeNull();
    expect(window.location.href).not.toContain(CODE);
  });

  it('?ended=1 shows the ended page and never calls the exchange', async () => {
    let called = false;
    server.use(
      http.post('/api/v1/auth/impersonation/exchange', () => {
        called = true;
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    renderWithRouter(routeTree, { initialEntries: ['/support/enter?ended=1'], locale: 'en' });
    await waitFor(() => expect(screen.getByText('Biddaloy support has ended')).toBeTruthy());
    expect(screen.getByText('You can close this tab.')).toBeTruthy();
    expect(called).toBe(false);
  });
});
