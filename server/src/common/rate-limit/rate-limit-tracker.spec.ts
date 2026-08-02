import { describe, it, expect, vi } from "vitest";
import { buildRateLimitTracker } from "./rate-limit-tracker";

function fakeJwtService(behavior: { verifyAsync: (token: string) => Promise<any> }) {
  return { verifyAsync: vi.fn(behavior.verifyAsync) } as any;
}

describe("buildRateLimitTracker", () => {
  it("keys by the JWT's sub when a valid Bearer token is present", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: "user-123" }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: "Bearer a.valid.token" }, ip: "1.2.3.4" });

    expect(key).toBe("user:user-123");
  });

  it("falls back to IP when there is no Authorization header", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: "user-123" }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: {}, ip: "1.2.3.4" });

    expect(key).toBe("ip:1.2.3.4");
  });

  it("falls back to IP when the Authorization header isn't a Bearer token", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: "user-123" }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: "Basic dXNlcjpwYXNz" }, ip: "1.2.3.4" });

    expect(key).toBe("ip:1.2.3.4");
  });

  it("falls back to IP when the token fails verification", async () => {
    const jwtService = fakeJwtService({
      verifyAsync: async () => {
        throw new Error("invalid signature");
      },
    });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: "Bearer garbage" }, ip: "5.6.7.8" });

    expect(key).toBe("ip:5.6.7.8");
  });

  it("falls back to IP when the verified payload has no sub", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({}) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: "Bearer a.valid.token" }, ip: "9.9.9.9" });

    expect(key).toBe("ip:9.9.9.9");
  });
});
