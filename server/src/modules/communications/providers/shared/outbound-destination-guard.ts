import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Blocks outbound provider requests (SMS gateway `apiUrl`, SMTP `host`)
 * from reaching an internal/private address. A tenant-custom `apiUrl` is
 * an intentionally supported feature (see `greenweb-sms.gateway.spec.ts`'s
 * `'uses a tenant-configured apiUrl when given'` test) — a domain
 * allowlist would break it — so this checks the *class* of address
 * (private/loopback/link-local/metadata) rather than the hostname itself.
 *
 * Resolves the hostname once via `dns.lookup` and checks the returned
 * address; the actual `fetch`/SMTP connection re-resolves independently,
 * so this reduces but does not eliminate SSRF via DNS rebinding (an
 * attacker's DNS server returning a public IP for this check and a
 * private one moments later, for the real connection). Fully closing that
 * would mean pinning the checked IP through the actual connection (a
 * custom `fetch` dispatcher / nodemailer host override with the original
 * hostname kept for TLS SNI), which is meaningfully more code — revisit
 * only if this becomes a live threat-model concern.
 */
export class DestinationBlockedError extends Error {
  constructor(reason: string) {
    super(`Outbound destination blocked: ${reason}`);
    this.name = 'DestinationBlockedError';
  }
}

// IPv4 private/reserved ranges, expressed as [network, prefixLength].
const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 cloud metadata address
  ['100.64.0.0', 10], // carrier-grade NAT
  ['0.0.0.0', 8],
];

// Plain arithmetic rather than bitwise ops — `<<`/`>>>` coerce to signed
// 32-bit ints in JS, which silently mis-masks any octet ≥ 128 (every
// range below has one). Everything here stays well under
// Number.MAX_SAFE_INTEGER, so floating-point division is exact.
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isPrivateIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([network, prefixLength]) => {
    const blockSize = 2 ** (32 - prefixLength);
    return Math.floor(ipInt / blockSize) === Math.floor(ipv4ToInt(network) / blockSize);
  });
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' || // loopback
    normalized.startsWith('fc') || // unique local fc00::/7
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') || // link-local
    normalized === '::' ||
    normalized.startsWith('::ffff:127.') || // IPv4-mapped loopback
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  // Not a literal IP — caller resolves it via DNS before calling this.
  return false;
}

async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new DestinationBlockedError(`"${hostname}" is a private/reserved address.`);
    }
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new DestinationBlockedError(`"${hostname}" could not be resolved.`);
  }
  const privateHit = addresses.find(({ address }) => isPrivateAddress(address));
  if (privateHit) {
    throw new DestinationBlockedError(
      `"${hostname}" resolves to a private/reserved address (${privateHit.address}).`,
    );
  }
}

/** For SMS gateway `apiUrl` values — used with `fetch()`. */
export async function assertSafeHttpDestination(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DestinationBlockedError(`"${rawUrl}" is not a valid URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new DestinationBlockedError(`"${rawUrl}" must use https:.`);
  }
  await assertResolvesToPublicAddress(url.hostname);
}

/** For SMTP `host`/`port` — no protocol concept, so no scheme check. */
export async function assertSafeSmtpDestination(host: string, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DestinationBlockedError(`port ${port} is not a valid TCP port.`);
  }
  await assertResolvesToPublicAddress(host);
}
