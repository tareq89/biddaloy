import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSessionExpiredHandler, setAccessToken } from '../api/auth-state';
import { RateLimitedError } from '../api/errors';
import { server } from '../test/msw/server';

import { cockpitRequest } from './cockpit-request';

afterEach(() => {
  registerSessionExpiredHandler(null);
  setAccessToken(null);
});

describe('cockpitRequest 401', () => {
  const refuse = () =>
    server.use(
      http.get('*/platform/owners', () => HttpResponse.json({ message: 'x' }, { status: 401 })),
      http.post('*/platform/step-up', () => HttpResponse.json({ message: 'x' }, { status: 401 })),
    );

  it('ends the session once when a signed-in call is refused', async () => {
    const expired = vi.fn();
    registerSessionExpiredHandler(expired);
    setAccessToken('tok');
    refuse();
    await expect(cockpitRequest({ url: '/platform/owners' })).rejects.toBeDefined();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('leaves a wrong step-up code, and a call with no session, as plain errors', async () => {
    const expired = vi.fn();
    registerSessionExpiredHandler(expired);
    refuse();
    setAccessToken('tok');
    await expect(
      cockpitRequest({ method: 'POST', url: '/platform/step-up' }),
    ).rejects.toBeDefined();
    setAccessToken(null);
    await expect(cockpitRequest({ url: '/platform/owners' })).rejects.toBeDefined();
    expect(expired).not.toHaveBeenCalled();
  });

  it('ignores a 401 for a token a newer sign-in already replaced', async () => {
    const expired = vi.fn();
    registerSessionExpiredHandler(expired);
    setAccessToken('old');
    server.use(
      http.get('*/platform/owners', () => {
        setAccessToken('new');
        return HttpResponse.json({ message: 'x' }, { status: 401 });
      }),
    );
    await expect(cockpitRequest({ url: '/platform/owners' })).rejects.toBeDefined();
    expect(expired).not.toHaveBeenCalled();
  });

  it('leaves a call that brings its own Authorization header (hand-off token) as a plain error', async () => {
    const expired = vi.fn();
    registerSessionExpiredHandler(expired);
    setAccessToken('tok');
    refuse();
    await expect(
      cockpitRequest({ url: '/platform/owners', headers: { Authorization: 'Bearer handoff' } }),
    ).rejects.toBeDefined();
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('cockpitRequest 429', () => {
  it('throws RateLimitedError with the parsed Retry-After', async () => {
    server.use(
      http.post('*/auth/cockpit/login', () =>
        HttpResponse.json({ message: 'x' }, { status: 429, headers: { 'Retry-After': '45' } }),
      ),
    );
    const error = await cockpitRequest({ method: 'POST', url: '/auth/cockpit/login' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(45);
  });

  it('has a null wait when Retry-After is missing', async () => {
    server.use(
      http.post('*/auth/cockpit/login', () => HttpResponse.json({ message: 'x' }, { status: 429 })),
    );
    const error = await cockpitRequest({ method: 'POST', url: '/auth/cockpit/login' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });
});
