import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { FailOpenThrottlerStorage } from './fail-open-throttler-storage';

describe('FailOpenThrottlerStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the wrapped storage and returns its result on success', async () => {
    const record = { totalHits: 3, timeToExpire: 45, isBlocked: false, timeToBlockExpire: 0 };
    const delegate = { increment: vi.fn().mockResolvedValue(record) };
    const storage = new FailOpenThrottlerStorage(delegate);

    const result = await storage.increment('key', 60_000, 100, 60_000, 'default');

    expect(delegate.increment).toHaveBeenCalledWith('key', 60_000, 100, 60_000, 'default');
    expect(result).toBe(record);
  });

  // Redis is already a hard dependency for BullMQ, so an outage here is
  // already an incident — failing open keeps the API serving traffic
  // instead of turning a Redis blip into a site-wide 500 on every request.
  it('fails open (allows the request) when the delegate throws', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = new FailOpenThrottlerStorage(delegate);

    const result = await storage.increment('key', 60_000, 100, 60_000, 'default');

    expect(result).toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('logs the failure loudly rather than swallowing it silently', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = new FailOpenThrottlerStorage(delegate);

    await storage.increment('key', 60_000, 100, 60_000, 'default');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
      expect.any(String),
    );
  });

  it('fails open even when the delegate throws a non-Error value', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue('redis went away') };
    const storage = new FailOpenThrottlerStorage(delegate);

    const result = await storage.increment('key', 60_000, 100, 60_000, 'default');

    expect(result.isBlocked).toBe(false);
  });
});
