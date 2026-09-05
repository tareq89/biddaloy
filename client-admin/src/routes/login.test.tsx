import { getAccessToken, getActiveTenant } from '@biddaloy/ui/api';
import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
  it('completes a challenge without session or navigation, then requires a fresh sign-in', async () => {
    let completionBody: unknown;
    let loginCalls = 0;
    server.use(
      authHandlers.refreshFailure,
      http.post('/api/v1/auth/login', () => {
        loginCalls += 1;
        return HttpResponse.json({
          password_change_required: true,
          reset_token: 'test-challenge',
          expires_at: '2030-01-01T00:00:00Z',
        });
      }),
      http.post('/api/v1/auth/complete-password-reset', async ({ request }) => {
        completionBody = await request.json();
        expect(request.headers.get('X-Tenant-ID')).toBeNull();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { router, queryClient } = renderWithRouter(routeTree, {
      initialEntries: ['/login'],
      locale: 'en',
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Choose a new password' });
    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'replacement');
    await user.type(screen.getByLabelText('Confirm new password'), 'replacement');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Your password has been changed',
    );
    expect(completionBody).toEqual({ reset_token: 'test-challenge', new_password: 'replacement' });
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('');
    expect(getAccessToken()).toBeNull();
    expect(loginCalls).toBe(1);
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
  });
  it('shows invalid/expired challenge error and cancel forgets the form', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({
          password_change_required: true,
          reset_token: 'test-challenge',
          expires_at: '2030-01-01T00:00:00Z',
        }),
      ),
      http.post(
        '/api/v1/auth/complete-password-reset',
        () => new HttpResponse(null, { status: 400 }),
      ),
    );
    renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });
    await signIn();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'replacement');
    await user.type(screen.getByLabelText('Confirm new password'), 'replacement');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('invalid or expired');
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect((await screen.findByLabelText<HTMLInputElement>('Password')).value).toBe('');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
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

    // `/` is the audience redirect since [8.9.10] — the mock login response
    // holds a single ADMIN membership, so this lands on the staff dashboard.
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
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
