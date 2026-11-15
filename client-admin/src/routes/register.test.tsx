import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/register consent line (3329.3.01)', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  const open = (locale: 'en' | 'bn') => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register'], locale });
  };

  it.each([
    ['en', 'terms', 'privacy policy'],
    ['bn', 'শর্তাবলি', 'গোপনীয়তা নীতিতে'],
  ] as const)('links terms and privacy in %s, new tab', async (locale, terms, privacy) => {
    vi.stubEnv('VITE_LANDING_URL', 'https://site.test/');
    open(locale);

    const t = await screen.findByRole<HTMLAnchorElement>('link', { name: terms });
    const p = screen.getByRole<HTMLAnchorElement>('link', { name: privacy });
    expect(t.getAttribute('href')).toBe(`https://site.test/${locale}/terms`);
    expect(p.getAttribute('href')).toBe(`https://site.test/${locale}/privacy`);
    for (const a of [t, p]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('clicking a link does not toggle the checkbox', async () => {
    vi.stubEnv('VITE_LANDING_URL', 'https://site.test');
    open('en');

    const link = await screen.findByRole('link', { name: 'terms' });
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });

  it('renders plain words, no links, when the landing base is empty', async () => {
    vi.stubEnv('VITE_LANDING_URL', '');
    open('en');

    expect(await screen.findByText(/I agree to the terms and privacy policy/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /terms|privacy/ })).toBeNull();
  });
});

describe('/register', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends a signed-in visitor away instead of showing the sign-up card', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/register'));
  });

  it('shows the sign-up card to a signed-out visitor (public path, no bounce to /login)', async () => {
    server.use(authHandlers.refreshFailure);
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/register'],
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/register');
  });

  // The server's social callback sends `?social=<provider>` (social-auth.service.ts).
  it('shows "Continuing with Google" after the Google round trip', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register?social=google'], locale: 'en' });

    expect(await screen.findByText('Continuing with Google')).toBeTruthy();
  });

  it('says so when the social sign-up failed', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/register?social=failed'], locale: 'en' });

    expect(await screen.findByText(/Signing up with that account did not work/)).toBeTruthy();
    expect(screen.queryByText(/Continuing with/)).toBeNull();
  });

  it('warns in the demo that the test inbox is public', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.get('/api/v1/demo/roles', () =>
        HttpResponse.json({ enabled: true, password: 'x', cards: [] }),
      ),
    );
    renderWithRouter(routeTree, { initialEntries: ['/register'], locale: 'en' });

    expect(await screen.findByText(/Do not enter a real phone number or email/)).toBeTruthy();
  });
});
