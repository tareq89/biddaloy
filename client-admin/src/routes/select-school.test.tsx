import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

/** `decodeAccessTokenMemberships` never checks a signature (see
 * `session.ts`'s own comment) — same fake-JWT shape as `session.test.ts`. */
function fakeJwtWithMemberships(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const twoSchools = [
  { tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview School' },
  { tenantId: 'tenant-2', role: 'TEACHER', name: 'Rose Valley School' },
];

describe('/select-school', () => {
  it('renders the picker for 2+ memberships and is axe clean', async () => {
    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Choose a school' })).toBeTruthy(),
    );
    expect(screen.getByRole('radio', { name: 'Greenview School, Admin' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Rose Valley School, Teacher' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('picking a school activates it and navigates to the originally-requested page', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Choose a school' });

    await user.click(screen.getByText('Rose Valley School'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('an unconfirmed admin goes to the support-access welcome page after choosing', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/support-access/settings', () =>
        HttpResponse.json({
          mode: 'allowed',
          confirmedAt: null,
          confirmedByName: null,
          textVersion: 0,
          currentTextVersion: 1,
          needsConfirmation: true,
        }),
      ),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Choose a school' });

    await user.click(screen.getByText('Greenview School'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome/support-access'));
  });

  it('a slow lookup for an earlier choice does not navigate over the newer choice', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/support-access/settings', async () => {
        await delay(400);
        return HttpResponse.json({
          mode: 'allowed',
          confirmedAt: null,
          confirmedByName: null,
          textVersion: 0,
          currentTextVersion: 1,
          needsConfirmation: true,
        });
      }),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school?redirect=%2Fstudents'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Choose a school' });

    // The admin school starts a slow lookup; the teacher school (no lookup) is chosen after it.
    await user.click(screen.getByText('Greenview School'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByText('Rose Valley School'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    await new Promise((r) => setTimeout(r, 700));
    expect(router.state.location.pathname).toBe('/students');
  });

  it('auto-activates a lone membership and navigates away without showing a picker', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships([twoSchools[0]]),
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('heading', { name: 'Choose a school' })).toBeNull();
  });

  it('zero memberships: shows an empty state with a way out, and the way out signs out', async () => {
    const user = userEvent.setup();
    let logouts = 0;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { router, container } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships([]),
      locale: 'en',
    });

    expect(
      await screen.findByRole('heading', { name: 'You are not in any school yet' }),
    ).toBeTruthy();
    // Revoked server-side on arrival, in case the tab is just closed.
    await waitFor(() => expect(logouts).toBeGreaterThan(0));
    expect(screen.getByText("Ask your school's admin to add you.")).toBeTruthy();
    await expect(container).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('zero memberships: links "Contact us" to the runtime-config supportUrl when it is set', async () => {
    window.__BIDDALOY_CONFIG__ = { supportUrl: 'https://example.com/help' };
    server.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })));
    try {
      renderWithRouter(routeTree, {
        initialEntries: ['/select-school'],
        accessToken: fakeJwtWithMemberships([]),
        locale: 'en',
      });

      expect((await screen.findByRole('link', { name: 'Contact us' })).getAttribute('href')).toBe(
        'https://example.com/help',
      );
    } finally {
      delete window.__BIDDALOY_CONFIG__;
    }
  });

  it('"Sign in with another account" signs out and lands on /login', async () => {
    const user = userEvent.setup();
    server.use(authHandlers.logout);
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/select-school'],
      accessToken: fakeJwtWithMemberships(twoSchools),
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Choose a school' });

    await user.click(screen.getByRole('button', { name: 'Sign in with another account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
