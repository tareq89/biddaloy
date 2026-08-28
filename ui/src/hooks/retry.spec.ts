import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/errors';

import { shouldRetryQuery } from './retry';

function apiError(statusCode: number): ApiError {
  return new ApiError({
    statusCode,
    message: 'boom',
    timestamp: new Date().toISOString(),
    path: '/x',
    requestId: 'r1',
  });
}

describe('shouldRetryQuery', () => {
  it('never retries a 4xx ApiError, regardless of failureCount', () => {
    expect(shouldRetryQuery(0, apiError(400))).toBe(false);
    expect(shouldRetryQuery(0, apiError(404))).toBe(false);
    expect(shouldRetryQuery(0, apiError(499))).toBe(false);
  });

  it('does not treat 5xx as a 4xx — those are still eligible to retry', () => {
    expect(shouldRetryQuery(0, apiError(500))).toBe(true);
  });

  it('retries a non-ApiError failure (network error, etc.) up to the cap', () => {
    expect(shouldRetryQuery(0, new Error('network down'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('network down'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('network down'))).toBe(false);
  });

  describe('[8.12.3] when the browser reports no network at all', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not retry, so the Dexie fallback is reached immediately', () => {
      vi.stubGlobal('navigator', { onLine: false });

      // Two retries of a request that provably cannot leave the device
      // buy nothing but ~3s of spinner before the cached copy appears.
      expect(shouldRetryQuery(0, new Error('network down'))).toBe(false);
    });

    it('still retries when the browser claims to be online', () => {
      // `onLine === true` proves nothing (a captive portal reads as
      // online), so it must not change the existing behaviour.
      vi.stubGlobal('navigator', { onLine: true });

      expect(shouldRetryQuery(0, new Error('network down'))).toBe(true);
    });

    it('falls through where there is no navigator at all', () => {
      vi.stubGlobal('navigator', undefined);

      expect(shouldRetryQuery(0, new Error('network down'))).toBe(true);
    });
  });
});
