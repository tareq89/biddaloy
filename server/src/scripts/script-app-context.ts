import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import Redis from 'ioredis';
import { queueWorkers } from '../common/queue-workers';

const REDIS_CHECK_TIMEOUT_MS = 2_000;

/**
 * Boots `AppModule` for a one-off script (seed, re-encrypt) WITHOUT starting
 * its BullMQ workers. A script only wants the services and the DataSource;
 * running workers would pull real jobs off Redis — which in dev is shared
 * with other databases (e2e, test), so the script ended up processing other
 * environments' jobs ("backup schedule job failed ... School not found").
 *
 * The switch is read when `app.module.ts` is first evaluated, so it must be
 * flipped before that import — hence the dynamic `import()` below instead of
 * a top-of-file `import { AppModule }`.
 */
export async function createScriptAppContext(): Promise<INestApplicationContext> {
  queueWorkers.enabled = false;
  // Loading app.module also copies `.env` into process.env (ConfigModule's
  // synchronous `validate`), so REDIS_URL is readable from here on.
  const { AppModule } = await import('../app.module');
  await assertRedisReachable(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  return NestFactory.createApplicationContext(AppModule);
}

/**
 * AppModule's queue schedulers write to Redis while it boots, and ioredis
 * retries a dead server forever — so without this check a script with Redis
 * down hangs with an endless wall of ECONNREFUSED instead of failing.
 */
export async function assertRedisReachable(url: string): Promise<void> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: REDIS_CHECK_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null, // one attempt, no reconnect loop
  });
  // The failure already surfaces through connect()'s rejection below; without
  // a listener ioredis also prints an "Unhandled error event" stack trace.
  redis.on('error', () => {});
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    // Strip `user:password@` so a credentialed REDIS_URL never hits the terminal.
    const safeUrl = url.replace(/\/\/[^@/]*@/, '//***@');
    throw new Error(
      `Redis is not reachable at ${safeUrl} — start it with: docker compose up -d redis`,
    );
  } finally {
    redis.disconnect();
  }
}
