import { describe, it, expect } from "vitest";
import { resolveDefaultRateLimit, STRICT_RATE_LIMIT } from "./rate-limit";

describe("resolveDefaultRateLimit", () => {
  it("defaults to 100 requests per 60s when unset", () => {
    expect(resolveDefaultRateLimit(undefined, undefined)).toEqual({ limit: 100, ttl: 60_000 });
  });

  it("uses the env-provided limit and ttl when set", () => {
    expect(resolveDefaultRateLimit("250", "30000")).toEqual({ limit: 250, ttl: 30_000 });
  });

  it("allows overriding just one of the two", () => {
    expect(resolveDefaultRateLimit("10", undefined)).toEqual({ limit: 10, ttl: 60_000 });
    expect(resolveDefaultRateLimit(undefined, "5000")).toEqual({ limit: 100, ttl: 5_000 });
  });
});

describe("STRICT_RATE_LIMIT", () => {
  it("is a tighter bucket than the default tier", () => {
    const defaultTier = resolveDefaultRateLimit(undefined, undefined);

    expect(STRICT_RATE_LIMIT.limit).toBeLessThan(defaultTier.limit);
  });
});
