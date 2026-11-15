/**
 * [3329 / 4293]. The session ends while a form is half filled: the dialog opens, focus goes in,
 * typed text survives, nothing is replayed, and every unsafe case takes the old redirect. Auth
 * state is real; only the two network calls (`login`, `logout`) are mocked.
 */
import { act, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  notifySessionExpired,
  registerSessionExpiredHandler,
  setAccessToken,
  setActiveTenant,
  setSupportSession,
} from '../api/auth-state';
import { ApiError } from '../api/errors';
import { renderWithProviders } from '../test/render-with-providers';

import { SessionExpiredDialog, openSessionExpiredDialog } from './session-expired-dialog';

const { login, logout } = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));
vi.mock('../hooks/auth', () => ({ login, logout }));

const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
const save = vi.fn(); // stands in for any write; the dialog must never call it
const redirect = vi.fn();

function Page() {
  const [text, setText] = React.useState('');
  return (
    <>
      <input aria-label="note" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={save}>
        save
      </button>
      <SessionExpiredDialog />
    </>
  );
}

async function renderPage(opts: { support?: boolean } = {}) {
  setActiveTenant('t1');
  setAccessToken(jwt('u1'));
  if (opts.support) setSupportSession(true);
  const r = renderWithProviders(<Page />, { locale: 'en' });
  await act(async () => {
    await r.localeReady;
  });
  await r.user.type(screen.getByLabelText('note'), 'half typed fee note');
  registerSessionExpiredHandler(() => openSessionExpiredDialog(redirect));
  return r;
}

async function expire() {
  act(() => {
    notifySessionExpired();
  });
  await screen.findByRole('dialog').catch(() => undefined);
}

async function signIn(user: Awaited<ReturnType<typeof renderPage>>['user']) {
  await user.type(document.getElementById('sign-in-identifier')!, 'a@b.com');
  await user.type(document.getElementById('sign-in-password')!, 'pw');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

const note = () => screen.getByLabelText<HTMLInputElement>('note').value;

beforeEach(() => {
  login.mockReset();
  logout.mockReset().mockResolvedValue(undefined);
  save.mockReset();
  redirect.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe('SessionExpiredDialog', () => {
  it('opens on the handler, focus enters, the page stays, Esc leaves for sign-in', async () => {
    const { user } = await renderPage();
    await expire();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
    expect(note()).toBe('half typed fee note');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  });

  it('same person, same school: closes, keeps the text, replays nothing, stores nothing', async () => {
    const { user, queryClient } = await renderPage();
    const refetch = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    await expire();
    login.mockResolvedValue({
      access_token: jwt('u1'),
      memberships: [{ tenantId: 't1', role: 'ADMIN' }],
    });

    await signIn(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(note()).toBe('half typed fee note');
    expect(redirect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledWith({ type: 'active' }); // reads only
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('half typed');
  });

  it('a wrong password stays in the dialog with a fixed message', async () => {
    const { user } = await renderPage();
    await expire();
    login.mockRejectedValue(
      new ApiError({
        statusCode: 401,
        message: 'secret-detail',
        requestId: 'r',
        path: '/',
        timestamp: 't',
      }),
    );

    await signIn(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('secret-detail');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  });

  it.each([
    [
      'a different person',
      { access_token: jwt('u2'), memberships: [{ tenantId: 't1', role: 'A' }] },
    ],
    [
      'a different school',
      { access_token: jwt('u1'), memberships: [{ tenantId: 't2', role: 'A' }] },
    ],
    [
      'a school choice',
      {
        access_token: jwt('u1'),
        memberships: [
          { tenantId: 't1', role: 'A' },
          { tenantId: 't2', role: 'A' },
        ],
      },
    ],
  ])('%s signs out and redirects (fail closed)', async (_name, result) => {
    const { user } = await renderPage();
    await expire();
    login.mockResolvedValue(result);

    await signIn(user);

    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('a login-as (support) session redirects at once, no dialog', async () => {
    await renderPage({ support: true });
    await expire();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
