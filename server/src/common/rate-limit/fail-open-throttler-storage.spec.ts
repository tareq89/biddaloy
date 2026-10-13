import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  FailOpenThrottlerStorage,
  ThrottlerStorageUnavailableError,
} from './fail-open-throttler-storage';

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

  // The storage only reports; AppThrottlerGuard decides who fails closed.
  it('throws ThrottlerStorageUnavailableError when the delegate throws', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = new FailOpenThrottlerStorage(delegate);

    await expect(storage.increment('key', 60_000, 100, 60_000, 'default')).rejects.toBeInstanceOf(
      ThrottlerStorageUnavailableError,
    );
  });

  it('logs the failure loudly rather than swallowing it silently', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = new FailOpenThrottlerStorage(delegate);

    await storage.increment('key', 60_000, 100, 60_000, 'default').catch(() => undefined);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
      expect.any(String),
    );
  });

  it('throws the same error even when the delegate throws a non-Error value', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delegate = { increment: vi.fn().mockRejectedValue('redis went away') };
    const storage = new FailOpenThrottlerStorage(delegate);

    await expect(storage.increment('key', 60_000, 100, 60_000, 'default')).rejects.toBeInstanceOf(
      ThrottlerStorageUnavailableError,
    );
  });
});
