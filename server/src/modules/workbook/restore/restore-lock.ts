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

// Compare-and-extend: only refresh the TTL if the key still holds *this*
// job's id. A blind EXPIRE would extend whatever lock is currently there,
// even one a different (later) job already holds because this one's TTL
// expired mid-run.
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * Refreshes the per-tenant restore lock's TTL, but only while it is still
 * held by `jobId`. Returns `true` if the lock was renewed, `false` if it
 * had already expired or was taken over by another job — callers use that
 * to detect and abort a restore that outran its own lock.
 */
export async function renew(redis: Redis, tenantId: string, jobId: string): Promise<boolean> {
  const result = await redis.eval(RENEW_SCRIPT, 1, lockKey(tenantId), jobId, RESTORE_LOCK_TTL_SEC);
  return result === 1;
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
