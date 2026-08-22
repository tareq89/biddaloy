import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { buildSpaFallback } from './spa-fallback';

const CLIENT_DIST = '/srv/app/client-admin';
const INDEX_HTML = '/srv/app/client-admin/index.html';

interface SendFileCall {
  path: string;
  callback: (error?: Error) => void;
}

function fakeRequest(method: string, path: string): Request {
  return { method, path } as Request;
}

/** Captures the `sendFile` call rather than touching the filesystem — the
 * behaviour under test is "which path, and what happens when it fails",
 * not Express's own file streaming. */
function fakeResponse(): { res: Response; calls: SendFileCall[] } {
  const calls: SendFileCall[] = [];
  const res = {
    sendFile: (path: string, callback: (error?: Error) => void) => {
      calls.push({ path, callback });
    },
  } as unknown as Response;
  return { res, calls };
}

describe('buildSpaFallback', () => {
  it('serves index.html for a GET the client router owns', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/students/42'), res, next);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(INDEX_HTML);
    expect(next).not.toHaveBeenCalled();
  });

  it('serves index.html for a HEAD request too', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('HEAD', '/portal'), res, next);

    expect(calls).toHaveLength(1);
  });

  // Answering a POST with index.html would report 200 and a page for what
  // is really a 404 — the pre-[8.9.10] `POST /admin/x` behaviour.
  it('passes POST through to a 404', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('POST', '/anything'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('passes PUT through to a 404', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('PUT', '/anything'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('passes PATCH through to a 404', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('PATCH', '/anything'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('passes DELETE through to a 404', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('DELETE', '/anything'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('leaves /api to the API, which owns its own 404s', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/api'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('leaves /api/v1/students to the API, which owns its own 404s', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/api/v1/students'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  // express.static() runs before this in main.ts and already looked for
  // the file; reaching here means it's genuinely missing. Answering with
  // index.html would hide a broken deploy (a missing hashed JS/CSS bundle)
  // behind a silent 200 instead of a 404.
  it('leaves a missing /assets/ file to a real 404, not index.html', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/assets/missing.js'), res, next);

    expect(calls).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  // The old `GET /teacher/*` → 500: `client-teacher` never existed, so
  // `sendFile` hit ENOENT with no callback and Express reported a 500
  // rather than a 404.
  it('falls through to a 404 when the file cannot be read, instead of a 500', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/teacher/'), res, next);
    expect(next).not.toHaveBeenCalled();

    calls[0]?.callback(new Error('ENOENT: no such file or directory'));

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not call next when the file was sent successfully', () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn() as unknown as NextFunction;

    buildSpaFallback(CLIENT_DIST)(fakeRequest('GET', '/students'), res, next);
    calls[0]?.callback();

    expect(next).not.toHaveBeenCalled();
  });
});
