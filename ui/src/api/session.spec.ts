import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthState,
  getAccessToken,
  registerSessionExpiredHandler,
  setAccessToken,
} from './auth-state';
import { ensureSessionLoaded, resetSessionBootstrap, scheduleTokenRefresh } from './session';

// Plain `axios`, not `apiClient` — `postAuthRefresh` (client.ts) bypasses
// apiClient entirely (see its own comment on why), so this mocks the same
// surface `client.spec.ts`'s refresh tests do.
let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(axios);
});

afterEach(() => {
  mock.restore();
  clearAuthState();
  resetSessionBootstrap();
  registerSessionExpiredHandler(null);
  vi.useRealTimers();
});

/** Builds a token shaped enough to decode — `header.payload.signature`,
 * with a real base64url `exp` claim — without a real signature, since
 * `decodeJwtExpiryMs` never checks one (see session.ts's own comment). */
function fakeJwt(expUnixSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expUnixSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('ensureSessionLoaded', () => {
  it('resolves true with no network call when a token is already set', async () => {
    setAccessToken('already-set-token');
    // If this were called despite the token already being set, the
    // bootstrap would fail and resolve false — proving the short-circuit.
    mock.onPost('/api/v1/auth/refresh').reply(401);

    await expect(ensureSessionLoaded()).resolves.toBe(true);
    expect(mock.history.post.length).toBe(0);
  });

  it('bootstrap success sets the access token', async () => {
    mock.onPost('/api/v1/auth/refresh').reply(200, { access_token: 'restored-token' });

    await expect(ensureSessionLoaded()).resolves.toBe(true);
    expect(getAccessToken()).toBe('restored-token');
  });

  it('bootstrap failure resolves false and does not notify — a fresh visitor is routine, not an error', async () => {
    mock.onPost('/api/v1/auth/refresh').reply(401);
    const onSessionExpired = vi.fn();
    registerSessionExpiredHandler(onSessionExpired);

    await expect(ensureSessionLoaded()).resolves.toBe(false);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });

  it('concurrent calls before the first settles still only POST once (single-flight)', async () => {
    let callCount = 0;
    mock.onPost('/api/v1/auth/refresh').reply(() => {
      callCount += 1;
      return [200, { access_token: 'restored-token' }];
    });

    const [a, b] = await Promise.all([ensureSessionLoaded(), ensureSessionLoaded()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(callCount).toBe(1);
  });

  it('arms a proactive refresh that fires before the token expires, then re-arms with the new one', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mock.onPost('/api/v1/auth/refresh').reply(() => {
      callCount += 1;
      const nowSeconds = Math.floor(Date.now() / 1000);
      return [
        200,
        {
          // First response expires in 120s; the 60s refresh margin means
          // the proactive timer should fire ~60s from now. The second
          // response (after re-arming) isn't a decodable JWT — fine, it
          // just means no third timer gets armed, not relevant here.
          access_token: callCount === 1 ? fakeJwt(nowSeconds + 120) : 'second-token',
        },
      ];
    });

    await ensureSessionLoaded();
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(callCount).toBe(2);
    expect(getAccessToken()).toBe('second-token');
  });
});

describe('scheduleTokenRefresh', () => {
  it('does not arm a timer for a token with no decodable exp claim', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mock.onPost('/api/v1/auth/refresh').reply(() => {
      callCount += 1;
      return [200, { access_token: 'still-not-a-jwt' }];
    });

    scheduleTokenRefresh('not-a-jwt-at-all');
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(callCount).toBe(0);
  });
});

describe('resetSessionBootstrap', () => {
  it('cancels a pending proactive refresh and forgets the bootstrap ran', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mock.onPost('/api/v1/auth/refresh').reply(() => {
      callCount += 1;
      const nowSeconds = Math.floor(Date.now() / 1000);
      return [200, { access_token: fakeJwt(nowSeconds + 120) }];
    });

    await ensureSessionLoaded();
    expect(callCount).toBe(1);

    resetSessionBootstrap();
    clearAuthState(); // simulates logout clearing the token too
    await vi.advanceTimersByTimeAsync(60_000);

    // The armed timer was cancelled — no second refresh fired.
    expect(callCount).toBe(1);

    // And a later ensureSessionLoaded() re-attempts bootstrap from scratch
    // rather than replaying the old, memoized promise.
    await expect(ensureSessionLoaded()).resolves.toBe(true);
    expect(callCount).toBe(2);
  });
});
