import { describe, it, expect } from "vitest";
import { REFRESH_TOKEN_COOKIE, buildRefreshTokenCookieOptions, buildRefreshTokenClearCookieOptions } from "./token-cookie";

describe("REFRESH_TOKEN_COOKIE", () => {
  it("carries the __Host- prefix", () => {
    expect(REFRESH_TOKEN_COOKIE).toBe("__Host-refresh_token");
  });
});

describe("buildRefreshTokenCookieOptions", () => {
  it("is always httpOnly, Secure, SameSite=Strict, and Path=/ — the __Host- prefix's own requirements", () => {
    const options = buildRefreshTokenCookieOptions(1000);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("strict");
    expect(options.path).toBe("/");
  });

  it("never sets a Domain attribute — also required by __Host-", () => {
    expect(buildRefreshTokenCookieOptions(1000)).not.toHaveProperty("domain");
  });

  it("passes maxAge through unchanged", () => {
    expect(buildRefreshTokenCookieOptions(123_456).maxAge).toBe(123_456);
    expect(buildRefreshTokenCookieOptions(0).maxAge).toBe(0);
  });
});

describe("buildRefreshTokenClearCookieOptions", () => {
  it("matches the setting cookie's flags so the browser actually clears it", () => {
    const options = buildRefreshTokenClearCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("strict");
    expect(options.path).toBe("/");
  });

  it("omits maxAge — clearing a cookie is about deletion, not expiry", () => {
    expect(buildRefreshTokenClearCookieOptions()).not.toHaveProperty("maxAge");
  });
});
