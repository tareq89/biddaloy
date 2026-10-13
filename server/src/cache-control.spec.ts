import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { apiNoStoreByDefault, setStaticCacheHeaders } from './cache-control';

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('apiNoStoreByDefault', () => {
  it('sets no-store and calls next', () => {
    const { res, headers } = fakeRes();
    const next = vi.fn() as unknown as NextFunction;
    apiNoStoreByDefault({} as Request, res, next);
    expect(headers['Cache-Control']).toBe('no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('setStaticCacheHeaders', () => {
  it.each(['/x/index.html', '/x/sw.js'])('marks %s no-cache', (path) => {
    const { res, headers } = fakeRes();
    setStaticCacheHeaders(res, path);
    expect(headers['Cache-Control']).toBe('no-cache');
  });

  it.each(['/x/assets/app-abc.js', '/x/favicon.svg'])('leaves %s alone', (path) => {
    const { res, headers } = fakeRes();
    setStaticCacheHeaders(res, path);
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
