import { UserRole } from '@biddaloy/shared';
import {
  clearFirstPasswordGate,
  getFirstPasswordGate,
  requireFirstPassword,
} from '@biddaloy/ui/api';
import {
  authHandlers,
  cleanupTestState,
  loginResponseFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

async function signIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole('textbox', { name: 'Email or phone number' }),
    'rahim@greenview.edu.bd',
  );
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'hunter2fake');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** `/login` asks which social providers are on; no default MSW handler covers it. */
const socialProviders = (providers: string[]) =>
  http.get('/api/v1/auth/social/providers', () => HttpResponse.json({ providers }));

describe('/login', () => {
  beforeEach(() => {
    server.use(socialProviders([]));
  });

  afterEach(async () => {
    clearFirstPasswordGate();
    await cleanupTestState();
  });

  it('renders the real sign-in form', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/login'], tenantId: 'tenant-1', locale: 'en' });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy());
    expect(screen.getByRole('textbox', { name: 'Email or phone number' })).toBeTruthy();
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBeTruthy();
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

  describe('12.5: "With a code" tab', () => {
    it('defaults to the password tab, and switches to the OTP tab on click', async () => {
      server.use(authHandlers.refreshFailure);
      const user = userEvent.setup();
      renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });

      await waitFor(() =>
        expect(screen.getByLabelText('Password', { selector: 'input' })).toBeTruthy(),
      );

      await user.click(screen.getByRole('tab', { name: 'With a code' }));

      expect(await screen.findByLabelText('Mobile number or email')).toBeTruthy();
      expect(screen.queryByLabelText('Password', { selector: 'input' })).toBeNull();
    });

    it('`?method=otp` deep-links straight to the OTP tab', async () => {
      server.use(authHandlers.refreshFailure);
      renderWithRouter(routeTree, { initialEntries: ['/login?method=otp'], locale: 'en' });

      expect(await screen.findByLabelText('Mobile number or email')).toBeTruthy();
      expect(screen.queryByLabelText('Password', { selector: 'input' })).toBeNull();
    });

    it('a successful phone+OTP sign-in navigates to the dashboard, same as password', async () => {
      server.use(authHandlers.refreshFailure, authHandlers.otpRequest, authHandlers.otpVerify);

      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/login?method=otp'],
        locale: 'en',
      });
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
      await user.click(screen.getByRole('button', { name: 'Send code' }));

      await user.type(await screen.findByLabelText('6-digit code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    });

    it('an invalid OTP shows plain copy, never the raw server message', async () => {
      server.use(
        authHandlers.refreshFailure,
        authHandlers.otpRequest,
        authHandlers.otpVerifyInvalid,
      );

      renderWithRouter(routeTree, { initialEntries: ['/login?method=otp'], locale: 'en' });
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
      await user.click(screen.getByRole('button', { name: 'Send code' }));

      await user.type(await screen.findByLabelText('6-digit code'), '000000');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('That number, email or code is incorrect.');
      expect(screen.queryByText('Invalid credentials')).toBeNull();
    });

    it('a rate-limited OTP request shows the same calm wait message as password login', async () => {
      server.use(authHandlers.refreshFailure, authHandlers.otpRequestRateLimited);

      renderWithRouter(routeTree, { initialEntries: ['/login?method=otp'], locale: 'en' });
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
      await user.click(screen.getByRole('button', { name: 'Send code' }));

      const status = await screen.findByRole('status');
      expect(status.textContent).toBe('Too many attempts. Try again in 60 seconds.');
    });
  });

  describe('13.5: first time, social, first password', () => {
    it('the "First time here?" link switches the card to the code form and sets ?mode=code', async () => {
      server.use(authHandlers.refreshFailure);
      const user = userEvent.setup();
      const { router } = renderWithRouter(routeTree, { initialEntries: ['/login'], locale: 'en' });

      await user.click(
        await screen.findByRole('link', { name: 'First time here? Sign in with a code' }),
      );

      expect(await screen.findByLabelText('Mobile number or email')).toBeTruthy();
      expect(router.state.location.search).toMatchObject({ mode: 'code' });
    });

    it('code sign-in works with an email', async () => {
      server.use(authHandlers.refreshFailure, authHandlers.otpRequest, authHandlers.otpVerify);
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/login?mode=code'],
        locale: 'en',
      });
      const user = userEvent.setup();

      await user.type(
        await screen.findByLabelText('Mobile number or email'),
        'rahim@greenview.edu.bd',
      );
      await user.click(screen.getByRole('button', { name: 'Send code' }));
      await user.type(await screen.findByLabelText('6-digit code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    });

    function otpVerifyNeedingPassword(passwordRequired: boolean, role: string) {
      return http.post('/api/v1/auth/otp/verify', () =>
        HttpResponse.json({
          ...loginResponseFactory({
            memberships: [{ tenantId: 't1', role, name: 'Mock School' } as never],
          }),
          needs_password: true,
          password_required: passwordRequired,
        }),
      );
    }

    async function codeSignIn(): Promise<void> {
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Mobile number or email'), '1712345678');
      await user.click(screen.getByRole('button', { name: 'Send code' }));
      await user.type(await screen.findByLabelText('6-digit code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Sign in' }));
    }

    it('needs_password shows the password step in the same card; staff cannot skip', async () => {
      server.use(
        authHandlers.refreshFailure,
        authHandlers.otpRequest,
        otpVerifyNeedingPassword(true, 'TEACHER'),
        http.post('/api/v1/account/first-password', () => new HttpResponse(null, { status: 204 })),
      );
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/login?mode=code'],
        locale: 'en',
      });
      await codeSignIn();

      expect(await screen.findByRole('heading', { name: 'Set a password' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
      expect(router.state.location.pathname).toBe('/login');
      expect(getFirstPasswordGate()).toEqual(['TEACHER']);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('New password'), 'A-strong-pass1!');
      await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
      await user.click(screen.getByRole('button', { name: 'Set password' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
      expect(getFirstPasswordGate()).toBeNull();
    });

    it('a reload while a staff password is owed lands back on the card, not in the app', async () => {
      requireFirstPassword([UserRole.TEACHER]);
      server.use(
        http.post('/api/v1/account/first-password', () => new HttpResponse(null, { status: 204 })),
      );
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/students'],
        tenantId: 'tenant-1',
        role: UserRole.TEACHER,
        locale: 'en',
      });

      expect(await screen.findByRole('heading', { name: 'Set a password' })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/login');
      expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('New password'), 'A-strong-pass1!');
      await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
      await user.click(screen.getByRole('button', { name: 'Set password' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
      expect(getFirstPasswordGate()).toBeNull();
    });

    it('a reload on /login?mode=code while a password is owed shows the card, not sign-in', async () => {
      requireFirstPassword([UserRole.TEACHER]);
      renderWithRouter(routeTree, { initialEntries: ['/login?mode=code'], locale: 'en' });

      expect(await screen.findByRole('heading', { name: 'Set a password' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    });

    it('a leftover gate with no session shows sign-in, not the password card', async () => {
      requireFirstPassword([UserRole.TEACHER]);
      server.use(authHandlers.refreshFailure);
      renderWithRouter(routeTree, { initialEntries: ['/login?step=password'], locale: 'en' });

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Set a password' })).toBeNull();
    });

    it('a family account that may skip records no password gate', async () => {
      server.use(
        authHandlers.refreshFailure,
        authHandlers.otpRequest,
        otpVerifyNeedingPassword(false, 'PARENT'),
      );
      renderWithRouter(routeTree, { initialEntries: ['/login?mode=code'], locale: 'en' });
      await codeSignIn();
      expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeTruthy();
      expect(getFirstPasswordGate()).toBeNull();
    });

    it('a family account may skip the password step, then continues', async () => {
      server.use(
        authHandlers.refreshFailure,
        authHandlers.otpRequest,
        otpVerifyNeedingPassword(false, 'PARENT'),
      );
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/login?mode=code'],
        locale: 'en',
      });
      await codeSignIn();

      await userEvent.setup().click(await screen.findByRole('button', { name: 'Skip for now' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/portal'));
    });

    it('shows a link per enabled social provider, carrying the redirect', async () => {
      server.use(authHandlers.refreshFailure, socialProviders(['google', 'facebook']));
      renderWithRouter(routeTree, {
        initialEntries: ['/login?redirect=%2Fstudents'],
        locale: 'en',
      });

      const google = await screen.findByRole('link', { name: 'Continue with Google' });
      expect(google.getAttribute('href')).toBe(
        '/api/v1/auth/social/google/start?intent=login&redirect=%2Fstudents',
      );
      expect(screen.getByRole('link', { name: 'Continue with Facebook' })).toBeTruthy();
    });

    it('?social=not_linked explains what to do next', async () => {
      server.use(authHandlers.refreshFailure);
      renderWithRouter(routeTree, { initialEntries: ['/login?social=not_linked'], locale: 'en' });

      expect(
        await screen.findByText(
          'That account is not connected yet. Sign in with a code, then connect it from your account page.',
        ),
      ).toBeTruthy();
    });
  });
});
