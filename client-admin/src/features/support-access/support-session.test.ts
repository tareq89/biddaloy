import { clearAuthState, getAccessToken, getActiveRole, getActiveTenant } from '@biddaloy/ui/api';
import { isSupportSession, readSupportEntry } from '@biddaloy/ui/api';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enterSupportSession, takeFragmentCode } from './support-session';

const CODE = 'one-time-code-VALUE-123';

function fakeJwt(memberships: unknown[]): string {
  const payload = btoa(JSON.stringify({ exp: 9_999_999_999, memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
}

const TOKEN = fakeJwt([{ tenantId: 't-1', role: 'ADMIN', name: 'Greenview' }]);
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(axios);
  window.history.replaceState(null, '', '/support/enter');
});

afterEach(() => {
  mock.restore();
  clearAuthState();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('takeFragmentCode', () => {
  it('returns the code and removes the fragment from the address bar', () => {
    window.history.replaceState(null, '', `/support/enter#code=${CODE}`);
    expect(takeFragmentCode()).toBe(CODE);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(CODE);
  });

  it('returns null with no fragment', () => {
    expect(takeFragmentCode()).toBeNull();
  });
});

describe('enterSupportSession', () => {
  function happyPath() {
    mock
      .onPost('/api/v1/auth/impersonation/exchange')
      .reply(200, { access_token: TOKEN, sessionId: 's-1', expiresAt: FUTURE });
    mock.onGet('/api/v1/auth/impersonation/me').reply(200, { role: 'ADMIN' });
  }

  it('strips the fragment before the request is sent', async () => {
    window.history.replaceState(null, '', `/support/enter#code=${CODE}`);
    happyPath();
    const code = takeFragmentCode() as string;
    let hashAtRequest: string | null = null;
    mock.onPost('/api/v1/auth/impersonation/exchange').reply(() => {
      hashAtRequest = window.location.hash;
      return [200, { access_token: TOKEN, sessionId: 's-1', expiresAt: FUTURE }];
    });
    await enterSupportSession(code);
    expect(hashAtRequest).toBe('');
  });

  it('keeps the token in sessionStorage, never localStorage, and flags the tab', async () => {
    happyPath();
    const local = vi.spyOn(Storage.prototype, 'setItem');
    await enterSupportSession(CODE);
    expect(getAccessToken()).toBe(TOKEN);
    expect(getActiveTenant()).toBe('t-1');
    expect(getActiveRole()).toBe('ADMIN');
    expect(isSupportSession()).toBe(true);
    expect(sessionStorage.getItem('biddaloy:supportTab')).toContain(TOKEN);
    expect(localStorage.length).toBe(0);
    // the only write is the one sessionStorage entry
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('a reused or expired code rejects and signs nothing in', async () => {
    mock.onPost('/api/v1/auth/impersonation/exchange').reply(401, { statusCode: 401 });
    await expect(enterSupportSession(CODE)).rejects.toBeInstanceOf(Error);
    expect(getAccessToken()).toBeNull();
    expect(isSupportSession()).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('never reaches the console, nor the error message', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    mock.onPost('/api/v1/auth/impersonation/exchange').reply(401, { statusCode: 401 });
    const err = await enterSupportSession(CODE).catch((e: unknown) => e as Error);
    expect(String((err as Error).message)).not.toContain(CODE);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE);
    }
    expect(window.location.href).not.toContain(CODE);
  });
});

describe('reload', () => {
  it('restores a live entry', async () => {
    happyPath2();
    const { ensureSessionLoaded } = await import('@biddaloy/ui/api');
    clearMemoryOnly();
    expect(await ensureSessionLoaded()).toBe(true);
    expect(getAccessToken()).toBe(TOKEN);
    expect(isSupportSession()).toBe(true);
  });

  it('does not restore an expired entry, and asks for no refresh', async () => {
    sessionStorage.setItem(
      'biddaloy:supportTab',
      JSON.stringify({
        token: TOKEN,
        sessionId: 's-1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        tenantId: 't-1',
        role: 'ADMIN',
      }),
    );
    const { ensureSessionLoaded } = await import('@biddaloy/ui/api');
    expect(await ensureSessionLoaded()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(readSupportEntry()).toBeNull();
    expect(mock.history.post).toHaveLength(0);
  });

  function happyPath2() {
    sessionStorage.setItem(
      'biddaloy:supportTab',
      JSON.stringify({
        token: TOKEN,
        sessionId: 's-1',
        expiresAt: FUTURE,
        tenantId: 't-1',
        role: 'ADMIN',
      }),
    );
  }
  function clearMemoryOnly() {
    expect(getAccessToken()).toBeNull();
  }
});
