import {
  cleanupTestState,
  errorHandler,
  guardianFactory,
  renderWithRouter,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/**
 * [8.14.4] `/portal/account` — exercised through the real route tree so
 * `portal.tsx`'s `RequireRole` guard and `AppShell` wire up the same way
 * `portal/fees.test.tsx` documents for itself.
 *
 * The STUDENT-never-calls-`/guardians/mine` assertion is the load-bearing
 * one this suite exists for — see this file's own test below.
 */
describe('/portal/account', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.unstubAllGlobals();
  });

  function renderAccount(role: 'PARENT' | 'STUDENT' = 'PARENT') {
    return renderWithRouter(routeTree, {
      initialEntries: ['/portal/account'],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
  }

  it('renders the profile, password and sign-out cards, and never issues a /guardians/mine request, for STUDENT', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Student' })),
      ),
    );
    let guardianRequests = 0;
    server.use(
      http.get('/api/v1/guardians/mine', () => {
        guardianRequests += 1;
        return HttpResponse.json(guardianFactory());
      }),
    );

    renderAccount('STUDENT');

    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
    // [12.7] The read-only email/phone card with its "Change" buttons.
    expect(screen.getByRole('heading', { name: 'Email & phone' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    // Language and theme live in the account menu, not on this page.
    expect(screen.queryByRole('heading', { name: 'Preferences' })).toBeNull();
    // The page-level "Sign out" button, exact-matched — the Devices card's
    // own per-session buttons carry a distinct `Sign out — <device>`
    // accessible name (see `session-list.tsx`), so this can never be
    // ambiguous with those.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Contact numbers' })).toBeNull();

    // Give any accidental fire-and-forget request a tick to land before
    // asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(guardianRequests).toBe(0);
  });

  it('renders the cards, including the guardian-contact card, for PARENT', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Parent' })),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
    );

    renderAccount('PARENT');

    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Contact numbers' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Preferences' })).toBeNull();
    // The page-level "Sign out" button, exact-matched — the Devices card's
    // own per-session buttons carry a distinct `Sign out — <device>`
    // accessible name (see `session-list.tsx`), so this can never be
    // ambiguous with those.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  function session(id: string, daysAgo: number, current = false) {
    const at = new Date(Date.UTC(2026, 2, 15) - daysAgo * 86_400_000).toISOString();
    return {
      id,
      started_at: at,
      last_used_at: at,
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      ip_address: '10.0.0.1',
      current,
    };
  }

  it('shows five devices, the current one first, and "Show all" reveals the rest', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(userResponseFactory())),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
      http.get('/api/v1/auth/sessions', () =>
        HttpResponse.json({
          data: [
            ...Array.from({ length: 7 }, (_, i) => session(`s-${i}`, i + 1)),
            session('s-current', 30, true),
          ],
        }),
      ),
    );

    renderAccount('PARENT');

    const heading = await screen.findByRole('heading', { level: 2, name: 'Devices' });
    const card = heading.closest('section') as HTMLElement;
    const rows = await within(card).findAllByRole('listitem');
    expect(rows).toHaveLength(5);
    // The current device sorts first even though it was used least recently.
    expect(within(rows[0]!).getByText('This device')).toBeTruthy();

    const toggle = within(card).getByRole('button', { name: 'Show all 8 devices' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);

    expect(within(card).getAllByRole('listitem')).toHaveLength(8);
    expect(
      within(card).getByRole('button', { name: 'Show fewer' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('shows a translated message, never a raw key, when the push device list fails', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(userResponseFactory())),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
      http.get('/api/v1/me/push/subscriptions', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    // jsdom has no push support, which would short-circuit the list call.
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: 'default' });
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    try {
      renderAccount('PARENT');

      expect(await screen.findByText("Couldn't load your devices. Try again.")).toBeTruthy();
      expect(document.body.textContent).not.toContain('push.errors');
    } finally {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  it('shows "Not added" with an "Add" button for a missing phone, and badges the email', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(
          userResponseFactory({
            email: 'karim@example.com',
            email_verified_at: '2026-01-10T00:00:00.000Z',
            phone: null,
            phone_verified_at: null,
          }),
        ),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
    );

    renderAccount('PARENT');

    const card = (await screen.findByRole('heading', { level: 2, name: 'Email & phone' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(card).getByText('Not added')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Add' })).toBeTruthy();
    const email = within(card).getByText('karim@example.com').closest('p') as HTMLElement;
    expect(within(email).getByText('Verified')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('flags an unverified phone and shows it formatted', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ phone: '01711000004', phone_verified_at: null })),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
    );

    renderAccount('PARENT');

    const card = (await screen.findByRole('heading', { level: 2, name: 'Email & phone' })).closest(
      'section',
    ) as HTMLElement;
    const phone = within(card).getByText('01711-000004').closest('p') as HTMLElement;
    expect(within(phone).getByText('Unverified')).toBeTruthy();
  });

  it('renders zero <h1> while /users/me is pending', async () => {
    server.use(http.get('/api/v1/users/me', async () => new Promise(() => {})));

    renderAccount('PARENT');

    expect(await screen.findByText('Loading your account')).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });

  it('renders zero <h1> when /users/me errors', async () => {
    server.use(errorHandler('get', '/api/v1/users/me', 500));

    renderAccount('PARENT');

    expect(await screen.findByText(/Could not load your account/)).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });

  it('signs out and navigates to /login even when the server logout call fails', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ full_name: 'Karim Parent' })),
      ),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
      errorHandler('post', '/api/v1/auth/logout', 500),
    );

    const user = userEvent.setup();
    const { router } = renderAccount('PARENT');

    await screen.findByRole('heading', { level: 1, name: 'Account' });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('is axe clean', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(userResponseFactory())),
      http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
      http.get('/api/v1/auth/sessions', () =>
        HttpResponse.json({ data: [session('s-1', 1, true), session('s-2', 2)] }),
      ),
    );

    const { container } = renderAccount('PARENT');

    await screen.findByRole('heading', { level: 2, name: 'Devices' });
    await within(
      (await screen.findByRole('heading', { level: 2, name: 'Devices' })).closest(
        'section',
      ) as HTMLElement,
    ).findAllByRole('listitem');
    await expect(container).toHaveNoViolations();
  });
});
