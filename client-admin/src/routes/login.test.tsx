import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

async function signIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole('textbox', { name: 'Email or phone number' }),
    'rahim@greenview.edu.bd',
  );
  await user.type(screen.getByLabelText('Password'), 'hunter2fake');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('/login', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the real sign-in form', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/login'], tenantId: 'tenant-1', locale: 'en' });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(screen.getByRole('textbox', { name: 'Email or phone number' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    server.use(authHandlers.refreshFailure);

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/login'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => screen.getByRole('heading', { name: 'Sign in' }));
    await expect(container).toHaveNoViolations();
  });

  it('a successful sign-in navigates to the originally-requested page', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.login);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/login?redirect=%2Fstudents'],
      locale: 'en',
    });

    await signIn();

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('a successful sign-in with no redirect lands on the dashboard', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.login);

    const { router } = renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });

    await signIn();

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('a failed sign-in shows plain copy, never the raw server message or JSON', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.loginInvalidCredentials);

    renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });

    await signIn();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That email/phone or password is incorrect.');
    // The server's actual message string must never reach the DOM.
    expect(screen.queryByText('Invalid credentials')).toBeNull();
    expect(screen.queryByText(/statusCode/)).toBeNull();
  });

  it('a rate-limited sign-in shows a calm, specific wait message from Retry-After', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.loginRateLimited);

    renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });

    await signIn();

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Too many attempts. Try again in 45 seconds.');
  });

  it('a `redirect` search param outside the app is dropped, not carried through', async () => {
    server.use(authHandlers.refreshFailure);

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/login?redirect=//evil.com'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(router.state.location.search).toEqual({});
  });

  it('a backslash-based redirect that resolves off-origin is dropped too', async () => {
    server.use(authHandlers.refreshFailure);

    // Percent-encoded so it survives as a literal query value on the way
    // in — the router decodes it before validateSearch sees it, at the
    // same point `/\evil.com` would resolve off-origin (browsers treat a
    // leading `\` the same as `/`, per the WHATWG URL spec).
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/login?redirect=/%5Cevil.com'],
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(router.state.location.search).toEqual({});
  });
});
