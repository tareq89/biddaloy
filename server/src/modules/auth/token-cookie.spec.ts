import { describe, it, expect } from "vitest";
import {
  REFRESH_TOKEN_COOKIE_PATH,
  buildRefreshTokenCookieOptions,
  buildRefreshTokenClearCookieOptions,
} from "./token-cookie";

describe("buildRefreshTokenCookieOptions", () => {
  it("sets secure only in production", () => {
    expect(buildRefreshTokenCookieOptions("production", 1000).secure).toBe(true);
    expect(buildRefreshTokenCookieOptions("development", 1000).secure).toBe(false);
    expect(buildRefreshTokenCookieOptions("test", 1000).secure).toBe(false);
    expect(buildRefreshTokenCookieOptions(undefined, 1000).secure).toBe(false);
  });

  it("is always httpOnly, SameSite=Strict, and scoped to the auth path", () => {
    const options = buildRefreshTokenCookieOptions("development", 1000);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("strict");
    expect(options.path).toBe(REFRESH_TOKEN_COOKIE_PATH);
  });

  it("passes maxAge through unchanged", () => {
    expect(buildRefreshTokenCookieOptions("development", 123_456).maxAge).toBe(123_456);
    expect(buildRefreshTokenCookieOptions("development", 0).maxAge).toBe(0);
  });
});

describe("buildRefreshTokenClearCookieOptions", () => {
  it("matches the setting cookie's flags so the browser actually clears it", () => {
    const options = buildRefreshTokenClearCookieOptions("production");
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("strict");
    expect(options.path).toBe(REFRESH_TOKEN_COOKIE_PATH);
  });

  it("omits maxAge — clearing a cookie is about deletion, not expiry", () => {
    expect(buildRefreshTokenClearCookieOptions("production")).not.toHaveProperty("maxAge");
  });

  it("sets secure only in production", () => {
    expect(buildRefreshTokenClearCookieOptions("development").secure).toBe(false);
    expect(buildRefreshTokenClearCookieOptions(undefined).secure).toBe(false);
  });
});
