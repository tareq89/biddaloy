import { describe, expect, it } from 'vitest';

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
});
