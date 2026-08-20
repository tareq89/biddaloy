import type { JwtMembership } from '@biddaloy/shared';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthState,
  getAccessToken,
  registerSessionExpiredHandler,
  setAccessToken,
} from './auth-state';
import {
  decodeAccessTokenMemberships,
  ensureSessionLoaded,
  resetSessionBootstrap,
  scheduleTokenRefresh,
} from './session';

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

/** `btoa()` alone only accepts Latin-1 — encoding a multi-byte character (a
 * Bengali membership name) straight through it corrupts the payload before
 * it's even sent. Encodes via `TextEncoder` first, mirroring `session.ts`'s
 * own `decodeBase64UrlToString`, so a non-ASCII fixture round-trips
 * correctly through `decodeAccessTokenMemberships`. */
function encodeBase64UrlFromString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds a token shaped enough to decode — `header.payload.signature`,
 * with a real base64url `exp` claim (and, for [8.9.5]'s restore tests,
 * `memberships`) — without a real signature, since neither
 * `decodeJwtExpiryMs` nor `decodeAccessTokenMemberships` ever checks one
 * (see session.ts's own comment). */
function fakeJwt(expUnixSeconds: number, memberships: JwtMembership[] = []): string {
  const payload = encodeBase64UrlFromString(JSON.stringify({ exp: expUnixSeconds, memberships }));
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

  it("decodes a non-ASCII membership name correctly, not corrupted by atob's Latin-1 mapping", async () => {
    mock.onPost('/api/v1/auth/refresh').reply(200, {
      access_token: fakeJwt(9_999_999_999, [
        { tenantId: 'tenant-a', role: 'ADMIN' as never, name: 'গ্রীনভিউ স্কুল' },
      ]),
    });

    await ensureSessionLoaded();

    const token = getAccessToken();
    expect(token).not.toBeNull();
    expect(decodeAccessTokenMemberships(token ?? '')[0]?.name).toBe('গ্রীনভিউ স্কুল');
  });

  it('returns false and does not restore tenant state when the session is reset while a cold-boot refresh is in flight', async () => {
    let resolveRefresh: ((value: [number, { access_token: string }]) => void) | undefined;
    const refreshResponse = new Promise<[number, { access_token: string }]>((resolve) => {
      resolveRefresh = resolve;
    });
    mock.onPost('/api/v1/auth/refresh').reply(() => refreshResponse);

    const bootstrapping = ensureSessionLoaded();
    // Simulates a concurrent logout (or a failed sibling refresh) resetting
    // the session while this cold-boot refresh is still in flight —
    // `postAuthRefresh()` (client.ts) already guards against resurrecting
    // the access token in this case; this asserts `bootstrap()` itself
    // doesn't still report the session as authenticated.
    clearAuthState();
    resolveRefresh?.([200, { access_token: fakeJwt(9_999_999_999) }]);

    await expect(bootstrapping).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
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
