import { toast } from '@biddaloy/ui/components';
import {
  cleanupTestState,
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

function renderAt(path: string, role: 'ADMIN' | 'PARENT' = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    accessToken: 'header.e30.signature',
    locale: 'en',
  });
}

function mockPage(opts: { providers?: string[]; identities?: unknown[] } = {}) {
  server.use(
    http.get('/api/v1/auth/sessions', () => HttpResponse.json({ data: [] })),
    http.get('/api/v1/users/me', () => HttpResponse.json(userResponseFactory())),
    http.get('/api/v1/guardians/mine', () => HttpResponse.json(guardianFactory())),
    http.get('/api/v1/auth/social/providers', () =>
      HttpResponse.json({ providers: opts.providers ?? ['google', 'facebook'] }),
    ),
    http.get('/api/v1/auth/social/identities', () => HttpResponse.json(opts.identities ?? [])),
    http.get('/api/v1/schools/me/profile', () => HttpResponse.json({ name: 'Green Valley' })),
  );
}

const GOOGLE = { provider: 'google', email: 'me@example.com', created_at: '2026-10-01T00:00:00Z' };

describe('sign-in methods', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('with no provider configured shows only the password and code rows', async () => {
    mockPage({ providers: [] });
    renderAt('/security');

    expect(await screen.findByText('No password yet')).toBeTruthy();
    expect(screen.getByText('A code by SMS or email')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
  });

  it('shows Connected as … with Disconnect, and Connect for the rest', async () => {
    mockPage({ identities: [GOOGLE] });
    renderAt('/security');

    expect(await screen.findByText('Connected as me@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Facebook' })).toBeTruthy();
  });

  it('Connect asks the server for a link url and navigates there', async () => {
    mockPage();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    server.use(
      http.post('/api/v1/auth/social/google/link-start', () =>
        HttpResponse.json({ url: 'https://accounts.example/auth' }),
      ),
    );
    renderAt('/security');

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.example/auth'));
  });

  it('explains why the last sign-in method cannot be disconnected', async () => {
    mockPage({ identities: [GOOGLE] });
    server.use(
      http.delete('/api/v1/auth/social/identities/google', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'last',
            requestId: 'r1',
            details: { code: 'LAST_SIGN_IN_METHOD' },
          },
          { status: 409 },
        ),
      ),
    );
    renderAt('/security');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Google' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Set a password first, so you still have a way in.',
    );
  });

  it('opens the set-password dialog and saves a password', async () => {
    mockPage();
    let body: unknown;
    server.use(
      http.post('/api/v1/account/first-password', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderAt('/security');

    await userEvent.click(await screen.findByRole('button', { name: 'Set a password' }));
    const dialog = await screen.findByRole('dialog');
    const fields = within(dialog).getAllByLabelText(/password/i, { selector: 'input' });
    for (const field of fields) await userEvent.type(field, 'Correct-Horse-9-Battery');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set a password' }));

    await waitFor(() => expect(body).toEqual({ password: 'Correct-Horse-9-Battery' }));
    expect(await screen.findByText('Password is set')).toBeTruthy();
  });

  it.each([
    ['?linked=google', 'success', 'Google is now connected.'],
    ['?social=conflict', 'error', 'That account is already connected to someone else.'],
    ['?social=cancelled', 'error', 'Connecting the account was cancelled.'],
    ['?social=failed', 'error', 'We could not connect that account. Please try again.'],
  ] as const)('toasts for %s and drops the param', async (search, kind, message) => {
    mockPage();
    const spy = vi.spyOn(toast, kind);
    const { router } = renderAt(`/security${search}`);

    await waitFor(() => expect(spy).toHaveBeenCalledWith(message));
    await waitFor(() => expect(router.state.location.searchStr).toBe(''));
  });

  it('leave: dialog names the school and leaving signs the session out', async () => {
    mockPage();
    let left = false;
    server.use(
      http.post('/api/v1/users/me/leave', () => {
        left = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    const { router } = renderAt('/security');

    await userEvent.click(await screen.findByRole('button', { name: 'Leave this school' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByText(/Green Valley/)).toBeTruthy());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave school' }));

    await waitFor(() => expect(left).toBe(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('leave: the only admin is told to promote someone first', async () => {
    mockPage();
    server.use(
      http.post('/api/v1/users/me/leave', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'last', requestId: 'r1', details: { code: 'LAST_ADMIN' } },
          { status: 409 },
        ),
      ),
    );
    renderAt('/security');

    await userEvent.click(await screen.findByRole('button', { name: 'Leave this school' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave school' }));
    expect(
      await within(dialog).findByText('You are the only admin. Make someone else an admin first.'),
    ).toBeTruthy();
  });

  it('portal account shows the card and never the leave section', async () => {
    mockPage();
    renderAt('/portal/account', 'PARENT');

    expect(await screen.findByRole('heading', { name: 'Sign-in methods' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Leave this school' })).toBeNull();
  });
});
