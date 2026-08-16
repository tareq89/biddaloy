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
/** Common base for both error kinds below — callers that only need the
 * human-readable reason (e.g. surfacing a connection-test failure) can
 * catch this instead of the two subclasses individually. */
export abstract class OutboundDestinationError extends Error {}

// A permanent policy violation — invalid URL, wrong scheme, out-of-range
// port, or a hostname that resolves to a private/reserved address. This
// destination will not become valid on retry, so callers may treat it as
// non-retryable.
export class DestinationBlockedError extends OutboundDestinationError {
  constructor(reason: string) {
    super(`Outbound destination blocked: ${reason}`);
    this.name = 'DestinationBlockedError';
  }
}

// The DNS lookup itself failed — transient (resolver hiccup, momentary
// outage). Unlike DestinationBlockedError, this hostname may resolve
// successfully on a later attempt, so callers should keep it retryable.
export class DestinationResolutionError extends OutboundDestinationError {
  constructor(hostname: string) {
    super(`"${hostname}" could not be resolved.`);
    this.name = 'DestinationResolutionError';
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

// Link-local addresses are fe80::/10 — the first hextet ranges from
// 0xfe80 to 0xfebf. A plain `startsWith('fe80')` prefix check only
// catches fe80::/16, letting fe90::, fea0::, febf::, etc. through.
function isIpv6LinkLocal(normalized: string): boolean {
  const firstHextet = normalized.split(':', 1)[0];
  if (!/^[0-9a-f]{1,4}$/.test(firstHextet)) return false;
  const value = parseInt(firstHextet, 16);
  return value >= 0xfe80 && value <= 0xfebf;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' || // loopback
    normalized.startsWith('fc') || // unique local fc00::/7
    normalized.startsWith('fd') ||
    isIpv6LinkLocal(normalized) || // link-local fe80::/10
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
    throw new DestinationResolutionError(hostname);
  }
  const privateHit = addresses.find(({ address }) => isPrivateAddress(address));
  if (privateHit) {
    throw new DestinationBlockedError(
      `"${hostname}" resolves to a private/reserved address (${privateHit.address}).`,
    );
  }
}

// `URL#hostname` keeps the brackets around a literal IPv6 host (e.g.
// `[fe80::1]`) — neither `net.isIP` nor `dns.lookup` recognize that form,
// so a literal-IPv6 URL would otherwise silently skip the isIP() branch
// below and fail (or worse, hang) trying to DNS-resolve a bracketed string.
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
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
  await assertResolvesToPublicAddress(stripIpv6Brackets(url.hostname));
}

/** For SMTP `host`/`port` — no protocol concept, so no scheme check. */
export async function assertSafeSmtpDestination(host: string, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DestinationBlockedError(`port ${port} is not a valid TCP port.`);
  }
  await assertResolvesToPublicAddress(host);
}
