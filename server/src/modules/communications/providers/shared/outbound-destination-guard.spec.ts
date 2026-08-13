import { describe, it, expect, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import {
  assertSafeHttpDestination,
  assertSafeSmtpDestination,
  DestinationBlockedError,
} from './outbound-destination-guard';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

// `lookup` is overloaded (single-address vs. `{ all: true }` array
// response); `vi.mocked` picks the single-address signature, so the
// `{ all: true }` shape used throughout this file needs an explicit cast.
const mockLookup = vi.mocked(lookup) as unknown as {
  mockResolvedValueOnce: (value: Array<{ address: string; family: number }>) => void;
  mockRejectedValueOnce: (value: unknown) => void;
};

describe('assertSafeHttpDestination', () => {
  it('passes for https and a publicly-resolving hostname', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '203.0.113.5', family: 4 }]);
    await expect(assertSafeHttpDestination('https://api.example.com/v1')).resolves.toBeUndefined();
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

  it('rejects a hostname that DNS-resolves to a private address', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '192.168.1.5', family: 4 }]);
    await expect(assertSafeHttpDestination('https://internal.example.com/x')).rejects.toThrow(
      DestinationBlockedError,
    );
  });

  it('rejects a hostname that fails to resolve', async () => {
    mockLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(assertSafeHttpDestination('https://does-not-exist.example.com')).rejects.toThrow(
      DestinationBlockedError,
    );
  });
});

describe('assertSafeSmtpDestination', () => {
  it('passes for a publicly-resolving host and valid port', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '203.0.113.5', family: 4 }]);
    await expect(assertSafeSmtpDestination('smtp.example.com', 587)).resolves.toBeUndefined();
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
