/** [13.5.1] Connect hint: shown / hidden rules, dismiss, storage failure does not crash. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectHintCard } from './connect-hint-card';

// A JWT whose `sub` is the current user (the card keys its flag on it).
const token = `h.${btoa(JSON.stringify({ sub: 'user-1' }))}.s`;

function mock(providers: string[], identities: object[]) {
  server.use(
    http.get('/api/v1/auth/social/providers', () => HttpResponse.json({ providers })),
    http.get('/api/v1/auth/social/identities', () => HttpResponse.json(identities)),
  );
}

function renderCard() {
  const root = createRootRoute();
  const index = createRoute({ getParentRoute: () => root, path: '/', component: ConnectHintCard });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: token,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await cleanupTestState();
});

describe('ConnectHintCard', () => {
  it('shows when a provider exists and no identity is linked', async () => {
    mock(['google', 'facebook'], []);
    renderCard();
    expect(await screen.findByText('Sign in faster next time')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Facebook' })).toBeTruthy();
  });

  it('is hidden with no provider or with a linked identity', async () => {
    mock([], []);
    const a = renderCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Sign in faster next time')).toBeNull();
    a.unmount();
    mock(['google'], [{ provider: 'google', email: 'a@b.c' }]);
    renderCard();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Sign in faster next time')).toBeNull();
  });

  it('dismiss hides it and stores the flag', async () => {
    mock(['google'], []);
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Sign in faster next time')).toBeNull();
    expect(localStorage.getItem('biddaloy:connect-hint-dismissed:user-1')).toBe('1');
  });

  it('a failing storage does not crash the dismiss', async () => {
    mock(['google'], []);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Sign in faster next time')).toBeNull());
  });
});
