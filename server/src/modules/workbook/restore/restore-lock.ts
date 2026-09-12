import type Redis from 'ioredis';
import { RESTORE_LOCK_TTL_SEC } from './restore.constants';

function lockKey(tenantId: string): string {
  return `workbook:restore-lock:${tenantId}`;
}

/**
 * `SET key jobId NX EX ttl` — acquires the per-tenant restore lock only if
 * nothing currently holds it. Returns `true` on success, `false` if some
 * other job already holds the lock.
 */
export async function acquire(redis: Redis, tenantId: string, jobId: string): Promise<boolean> {
  const result = await redis.set(lockKey(tenantId), jobId, 'EX', RESTORE_LOCK_TTL_SEC, 'NX');
  return result === 'OK';
}

// Compare-and-delete: only remove the key if it still holds *this* job's
// id. A blind DEL would let a slow/late release wipe out the *next*
// restore's lock (acquired by a different job after this one's TTL or
// outcome already resolved it).
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/**
 * Releases the per-tenant restore lock, but only if it is still held by
 * `jobId`. Safe to call even if the lock was never acquired, already
 * expired, or is now held by a different job — in all those cases this is
 * a no-op.
 */
export async function release(redis: Redis, tenantId: string, jobId: string): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, lockKey(tenantId), jobId);
}
