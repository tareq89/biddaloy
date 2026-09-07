import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthService } from './health.service';

// ioredis is mocked so the probe never opens a real socket in the unit
// suite — its behaviour (ping resolves/rejects/hangs) is controlled per
// test via the mock instance below.
const mockPing = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('ioredis', () => ({
  default: class MockRedis {
    ping = mockPing;
    disconnect = mockDisconnect;
  },
}));

function fakeDataSource(query: () => Promise<unknown>) {
  return { query } as any;
}

function fakeQueue(getJobCounts: () => Promise<unknown>) {
  return { getJobCounts } as any;
}

describe('HealthService.readiness', () => {
  beforeEach(() => {
    mockPing.mockReset();
    mockDisconnect.mockReset();
  });

  it('reports ok for all checks when every probe succeeds', async () => {
    mockPing.mockResolvedValue('PONG');
    const service = new HealthService(
      fakeDataSource(() => Promise.resolve([{ '?column?': 1 }])),
      fakeQueue(() => Promise.resolve({ active: 0 })),
    );

    const result = await service.readiness();

    expect(result).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok', queue: 'ok' } });
  });

  it('fails only the redis check when redis rejects, and leaks no error text', async () => {
    mockPing.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6379'));
    const service = new HealthService(
      fakeDataSource(() => Promise.resolve([{ '?column?': 1 }])),
      fakeQueue(() => Promise.resolve({ active: 0 })),
    );

    const result = await service.readiness();

    expect(result.status).toBe('fail');
    expect(result.checks).toEqual({ db: 'ok', redis: 'fail', queue: 'ok' });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('fails the db check when the query rejects', async () => {
    mockPing.mockResolvedValue('PONG');
    const service = new HealthService(
      fakeDataSource(() => Promise.reject(new Error('relation "x" does not exist'))),
      fakeQueue(() => Promise.resolve({ active: 0 })),
    );

    const result = await service.readiness();

    expect(result.checks.db).toBe('fail');
    expect(result.status).toBe('fail');
  });

  it('fails a probe that never resolves, within the bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      mockPing.mockReturnValue(new Promise(() => {})); // never resolves
      const service = new HealthService(
        fakeDataSource(() => Promise.resolve([{ '?column?': 1 }])),
        fakeQueue(() => Promise.resolve({ active: 0 })),
      );

      const resultPromise = service.readiness();
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result.checks.redis).toBe('fail');
      expect(result.status).toBe('fail');
    } finally {
      vi.useRealTimers();
    }
  });
});
