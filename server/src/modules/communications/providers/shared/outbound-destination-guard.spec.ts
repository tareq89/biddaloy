import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import {
  assertSafeHttpDestination,
  assertSafeSmtpDestination,
  DestinationBlockedError,
  DestinationResolutionError,
} from './outbound-destination-guard';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

// `lookup` is overloaded (single-address vs. `{ all: true }` array
// response); `vi.mocked` picks the single-address signature, so the
// `{ all: true }` shape used throughout this file needs an explicit cast.
const mockLookup = vi.mocked(lookup) as unknown as {
  mockResolvedValueOnce: (value: Array<{ address: string; family: number }>) => void;
  mockRejectedValueOnce: (value: unknown) => void;
  mockClear: () => void;
};

beforeEach(() => {
  mockLookup.mockClear();
});

describe('assertSafeHttpDestination', () => {
  it('passes for https and a publicly-resolving hostname, returning the resolved address to pin', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '203.0.113.5', family: 4 }]);
    const destination = await assertSafeHttpDestination('https://api.example.com/v1');
    expect(destination.url.href).toBe('https://api.example.com/v1');
    expect(destination.addresses).toEqual([{ address: '203.0.113.5', family: 4 }]);
  });

  it('returns every resolved address, not just the first, when a hostname has multiple', async () => {
    mockLookup.mockResolvedValueOnce([
      { address: '203.0.113.5', family: 4 },
      { address: '203.0.113.6', family: 4 },
      { address: '2001:db8::1', family: 6 },
    ]);
    const destination = await assertSafeHttpDestination('https://api.example.com/v1');
    expect(destination.addresses).toHaveLength(3);
  });

  it('returns the literal address without calling dns.lookup when the host is already an IP', async () => {
    const destination = await assertSafeHttpDestination('https://203.0.113.5/x');
    expect(destination.addresses).toEqual([{ address: '203.0.113.5', family: 4 }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('pins a snapshot: a later, differently-resolving lookup for the same hostname does not affect an already-validated destination', async () => {
    // This is the DNS-rebinding proof: the guard's job is only to hand the
    // caller a snapshot to pin the real connection to — it doesn't (and
    // can't) prevent the hostname resolving differently on a later,
    // independent call. `assertSafeHttpDestination` returning the address
    // it validated on *this* call, unaffected by a second call's result,
    // is exactly what lets `fetchPinnedJson` bypass a rebinding attempt.
    mockLookup.mockResolvedValueOnce([{ address: '203.0.113.5', family: 4 }]);
    const first = await assertSafeHttpDestination('https://api.example.com/v1');

    mockLookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertSafeHttpDestination('https://api.example.com/v1')).rejects.toThrow(
      DestinationBlockedError,
    );

    expect(first.addresses).toEqual([{ address: '203.0.113.5', family: 4 }]);
  });

  it('rejects http (non-https) urls', async () => {
    await expect(assertSafeHttpDestination('http://api.example.com')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects a malformed url', async () => {
    await expect(assertSafeHttpDestination('not a url')).rejects.toThrow(DestinationBlockedError);
  });

  it('rejects a literal private IPv4 host', async () => {
    await expect(assertSafeHttpDestination('https://10.1.2.3/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects the cloud metadata address', async () => {
    await expect(
      assertSafeHttpDestination('https://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(DestinationBlockedError);
  });

  it('rejects loopback', async () => {
    await expect(assertSafeHttpDestination('https://127.0.0.1/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects a bracketed IPv6 loopback literal', async () => {
    // URL#hostname keeps the brackets around a literal IPv6 host — without
    // stripping them, this falls through the isIP() literal-address check
    // entirely and is treated as a hostname to DNS-resolve instead.
    await expect(assertSafeHttpDestination('https://[::1]/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects an IPv6 link-local address outside the fe80::/16 prefix', async () => {
    // fe80::/10 spans fe80:: through febf:: — a naive `startsWith('fe80')`
    // check only catches the first /16 of that range.
    await expect(assertSafeHttpDestination('https://[fe90::1]/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects the top of the fe80::/10 link-local range', async () => {
    await expect(assertSafeHttpDestination('https://[febf::1]/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('allows an IPv6 address just past the link-local range', async () => {
    // fec0::/10 is deprecated site-local, not link-local — a literal IP
    // host skips DNS lookup entirely, so no mock response is needed here.
    const destination = await assertSafeHttpDestination('https://[fec0::1]/x');
    expect(destination.addresses).toEqual([{ address: 'fec0::1', family: 6 }]);
  });

  it('rejects a hostname that DNS-resolves to a private address', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '192.168.1.5', family: 4 }]);
    await expect(assertSafeHttpDestination('https://internal.example.com/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects a hostname that fails to resolve, distinctly from a policy block', async () => {
    // A transient DNS failure isn't the same class of problem as a
    // resolved-to-private-address block — callers use this distinction to
    // decide what's safe to retry.
    mockLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(assertSafeHttpDestination('https://does-not-exist.example.com')).rejects.toThrow(
      DestinationResolutionError,
    );
  });
});

describe('assertSafeSmtpDestination', () => {
  it('passes for a publicly-resolving host and valid port, returning the resolved address and original hostname as servername', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '203.0.113.5', family: 4 }]);
    const destination = await assertSafeSmtpDestination('smtp.example.com', 587);
    expect(destination).toEqual({ host: '203.0.113.5', servername: 'smtp.example.com' });
  });

  it('picks the first resolved address and omits servername when the host is already a literal IP', async () => {
    const destination = await assertSafeSmtpDestination('203.0.113.5', 587);
    expect(destination).toEqual({ host: '203.0.113.5', servername: undefined });
  });

  it('rejects an out-of-range port', async () => {
    await expect(assertSafeSmtpDestination('smtp.example.com', 70000)).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects a literal private IPv4 host regardless of port', async () => {
    await expect(assertSafeSmtpDestination('10.0.0.5', 587)).rejects.toThrow(
      DestinationBlockedError,
    );
  });
});
