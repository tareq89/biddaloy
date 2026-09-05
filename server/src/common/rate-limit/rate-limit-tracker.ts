import { JwtService } from '@nestjs/jwt';

/**
 * Builds the tracker function ThrottlerModule uses to bucket requests.
 * Keying by IP alone would put every user behind one school's NAT in the
 * same bucket, so authenticated requests are keyed by the JWT's `sub`
 * instead, falling back to IP for anonymous routes (login, etc).
 *
 * This decodes the JWT itself rather than reading `request.user`: the
 * global rate-limit guard (an APP_GUARD) runs before the per-controller
 * `AuthGuard('jwt')`, so `request.user` isn't populated yet at this point.
 * A failed or missing token just falls back to IP — this tracker only
 * needs a stable bucket key, not an authorization decision; the real
 * `AuthGuard('jwt')` still rejects invalid tokens on protected routes.
 *
 * Deliberately does **not** special-case `X-Device-Key` ([9.5]): that
 * header is caller-supplied and unverified at this point in the request
 * lifecycle (this guard runs before `DeviceAuthGuard`), so bucketing on
 * its raw value would let anyone dodge the global IP/JWT bucket by
 * sending a fresh header value per request — a rate-limit bypass, not a
 * fix. Per-device throttling for the ingest route is applied by
 * `DeviceThrottlerGuard` instead, which runs *after* `DeviceAuthGuard`
 * has verified the key and only then keys on the authenticated
 * `request.currentDevice`.
 */
export function buildRateLimitTracker(jwtService: JwtService) {
  return async function getRateLimitTracker(req: Record<string, any>): Promise<string> {
    const authHeader = req.headers?.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    if (token) {
      try {
        const payload = await jwtService.verifyAsync(token);
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        // Invalid/expired token — fall through to IP keying.
      }
    }

    return `ip:${req.ip}`;
  };
}
