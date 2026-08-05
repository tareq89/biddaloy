import { describe, it, expect, vi } from 'vitest';
import { buildDocsBasicAuthMiddleware, buildDocsCspOverrideMiddleware } from './docs-auth';

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function fakeRes() {
  return {
    set: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('buildDocsBasicAuthMiddleware', () => {
  const middleware = buildDocsBasicAuthMiddleware('/api/docs', 'admin', 'hunter2');

  it('calls next() for correct credentials', () => {
    const req = {
      path: '/api/docs',
      headers: { authorization: basicAuthHeader('admin', 'hunter2') },
    } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', () => {
    const req = { path: '/api/docs', headers: {} } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Basic'));
  });

  it('rejects a non-Basic scheme', () => {
    const req = { path: '/api/docs', headers: { authorization: 'Bearer sometoken' } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a malformed Basic value with no colon separator', () => {
    const req = {
      path: '/api/docs',
      headers: { authorization: `Basic ${Buffer.from('nocolonhere').toString('base64')}` },
    } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects the wrong username', () => {
    const req = {
      path: '/api/docs',
      headers: { authorization: basicAuthHeader('wrong', 'hunter2') },
    } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects the wrong password', () => {
    const req = {
      path: '/api/docs',
      headers: { authorization: basicAuthHeader('admin', 'wrong') },
    } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // A password that's a prefix of the real one, or with different length
  // generally, must fail exactly like any other wrong password — this
  // guards against a length-based short-circuit creeping back in.
  it('rejects a password of different length', () => {
    const req = {
      path: '/api/docs',
      headers: { authorization: basicAuthHeader('admin', 'hunter2extra') },
    } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
  });

  // Regression guard: app.use('/api/docs', middleware) would not match
  // '/api/docs-json' (Express's mount matching requires a '/' boundary
  // after the prefix) — this middleware checks req.path itself instead of
  // relying on app.use's own routing, specifically so it also covers
  // SwaggerModule.setup's sibling raw-spec route.
  it('also gates /api/docs-json under the same prefix', () => {
    const reqNoAuth = { path: '/api/docs-json', headers: {} } as any;
    const res1 = fakeRes();
    const next1 = vi.fn();
    middleware(reqNoAuth, res1 as any, next1);
    expect(next1).not.toHaveBeenCalled();
    expect(res1.status).toHaveBeenCalledWith(401);

    const reqAuthed = {
      path: '/api/docs-json',
      headers: { authorization: basicAuthHeader('admin', 'hunter2') },
    } as any;
    const res2 = fakeRes();
    const next2 = vi.fn();
    middleware(reqAuthed, res2 as any, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('does not gate routes outside the docs prefix', () => {
    const req = { path: '/api/v1/students', headers: {} } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('buildDocsCspOverrideMiddleware', () => {
  const middleware = buildDocsCspOverrideMiddleware('/api/docs');

  it('sets a permissive CSP for the docs path', () => {
    const req = { path: '/api/docs' } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining('unsafe-inline'),
    );
    expect(next).toHaveBeenCalled();
  });

  it('also matches sub-paths under the docs prefix (e.g. the JSON spec)', () => {
    const req = { path: '/api/docs-json' } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalled();
  });

  it("leaves every other route's CSP untouched", () => {
    const req = { path: '/api/v1/students' } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
