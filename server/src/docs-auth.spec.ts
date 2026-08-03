import { describe, it, expect, vi } from "vitest";
import { buildDocsBasicAuthMiddleware, buildDocsCspOverrideMiddleware } from "./docs-auth";

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function fakeRes() {
  return {
    set: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe("buildDocsBasicAuthMiddleware", () => {
  const middleware = buildDocsBasicAuthMiddleware("admin", "hunter2");

  it("calls next() for correct credentials", () => {
    const req = { headers: { authorization: basicAuthHeader("admin", "hunter2") } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", () => {
    const req = { headers: {} } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith("WWW-Authenticate", expect.stringContaining("Basic"));
  });

  it("rejects a non-Basic scheme", () => {
    const req = { headers: { authorization: "Bearer sometoken" } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a malformed Basic value with no colon separator", () => {
    const req = { headers: { authorization: `Basic ${Buffer.from("nocolonhere").toString("base64")}` } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects the wrong username", () => {
    const req = { headers: { authorization: basicAuthHeader("wrong", "hunter2") } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects the wrong password", () => {
    const req = { headers: { authorization: basicAuthHeader("admin", "wrong") } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // A password that's a prefix of the real one, or with different length
  // generally, must fail exactly like any other wrong password — this
  // guards against a length-based short-circuit creeping back in.
  it("rejects a password of different length", () => {
    const req = { headers: { authorization: basicAuthHeader("admin", "hunter2extra") } } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
  });
});

describe("buildDocsCspOverrideMiddleware", () => {
  const middleware = buildDocsCspOverrideMiddleware("/api/docs");

  it("sets a permissive CSP for the docs path", () => {
    const req = { path: "/api/docs" } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Security-Policy", expect.stringContaining("unsafe-inline"));
    expect(next).toHaveBeenCalled();
  });

  it("also matches sub-paths under the docs prefix (e.g. the JSON spec)", () => {
    const req = { path: "/api/docs-json" } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalled();
  });

  it("leaves every other route's CSP untouched", () => {
    const req = { path: "/api/v1/students" } as any;
    const res = fakeRes();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
