import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';

/**
 * Builds the tracker function ThrottlerModule uses to bucket requests.
 * Keying by IP alone would put every user (or, for [9.5]'s device routes,
 * every device) behind one school's NAT in the same bucket, so
 * authenticated requests are keyed by the JWT's `sub` — or, for a device
 * request, the device key — instead, falling back to IP for anonymous
 * routes (login, etc).
 *
 * This decodes the JWT (and hashes the device key) itself rather than
 * reading `request.user`/`request.currentDevice`: the global rate-limit
 * guard (an APP_GUARD) runs before any per-controller guard
 * (`AuthGuard('jwt')`, `DeviceAuthGuard`), so neither is populated yet at
 * this point. A failed or missing credential just falls back to IP — this
 * tracker only needs a stable bucket key, not an authorization decision;
 * the real guard still rejects an invalid credential on protected routes.
 */
export function buildRateLimitTracker(jwtService: JwtService) {
  return async function getRateLimitTracker(req: Record<string, any>): Promise<string> {
    const deviceKey = req.headers?.['x-device-key'];
    if (typeof deviceKey === 'string' && deviceKey.length > 0) {
      // Bucketed on a hash, never the raw key, so a leaked rate-limit
      // store entry can't be used to reconstruct a device's credential.
      return `device:${createHash('sha256').update(deviceKey).digest('hex')}`;
    }

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
