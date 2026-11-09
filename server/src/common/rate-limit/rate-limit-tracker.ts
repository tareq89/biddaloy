import { JwtService } from '@nestjs/jwt';
import { BlockList, isIP } from 'node:net';
import { type SecretSource, verifyWithRotation } from '../../modules/auth/jwt-secrets';
import { normalizeHost } from '../../modules/website/public/site-host.service';

// Not the SSRF guard's helper: that one is unexported and also blocks link-local / CGNAT, which
// a docker overlay never uses. `req.ip` only (Rule 11), never X-Forwarded-For.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

function isPrivateCaller(ip: unknown): boolean {
  if (typeof ip !== 'string') return false;
  const addr = ip.toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  const v = isIP(addr);
  return v === 4 ? PRIVATE.check(addr, 'ipv4') : v === 6 ? PRIVATE.check(addr, 'ipv6') : false;
}

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
export function buildRateLimitTracker(jwtService: JwtService, config: SecretSource) {
  return async function getRateLimitTracker(req: Record<string, any>): Promise<string> {
    // Public site reads: the school-site container reaches us from a private overlay address, so
    // every school shares one IP bucket. Key those callers by host. A public caller never gets a
    // host key (it could burn another school's bucket), so it stays on its own ip bucket.
    const rawHost = req.params?.host;
    if (typeof rawHost === 'string' && isPrivateCaller(req.ip)) {
      const host = normalizeHost(rawHost);
      if (host) return `site:${host}`;
    }

    const authHeader = req.headers?.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    if (token) {
      try {
        const payload = await verifyWithRotation<{ sub?: string }>(jwtService, token, config);
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        // Invalid/expired token — fall through to IP keying.
      }
    }

    return `ip:${req.ip}`;
  };
}
