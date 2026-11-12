import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { acquire, isLocked } from '../../workbook/restore/restore-lock';
import { OpsSystemService, restoreLockKey } from './ops-system.service';

const OWNER = '11111111-1111-4111-8111-111111111111';

/**
 * Real Redis. Drift guard: if restore-lock.ts renames its key, `restoreLockKey` stops seeing
 * the lock and these fail. The DB side is stubbed (unit spec covers the SQL flow).
 */
describe('OpsSystemService (real Redis lock key)', () => {
  let redis: Redis;
  let svc: OpsSystemService;
  const school = randomUUID();
  const jobId = randomUUID();

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL!);
    const m = {
      query: async (sql: string) => (sql.startsWith('SELECT id') ? [] : [[], 0]),
    };
    const ds = {
      query: async () => [{}],
      transaction: async (fn: (mgr: typeof m) => unknown) => fn(m),
    };
    svc = new OpsSystemService(
      ds as never,
      redis,
      {} as never,
      { invalidate: async () => undefined } as never,
      { recordApproved: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    await redis.del(restoreLockKey(school));
    redis.disconnect();
  });

  it('the local key matches the real lock key and a fresh lock is 409', async () => {
    expect(await acquire(redis, school, jobId)).toBe(true);
    expect(await redis.ttl(restoreLockKey(school))).toBeGreaterThan(0);
    await expect(svc.releaseRestoreLock(school, OWNER)).rejects.toMatchObject({ status: 409 });
    expect(await isLocked(redis, school)).toBe(true);
  });

  it('a stale orphan lock is released and the school is unlocked again', async () => {
    await redis.expire(restoreLockKey(school), 60); // simulate a dead restore: no renewals
    await expect(svc.releaseRestoreLock(school, OWNER)).resolves.toEqual({
      released: true,
      failedJobs: 0,
    });
    expect(await isLocked(redis, school)).toBe(false);
  });
});
