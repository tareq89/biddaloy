import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';

export interface ReadinessResult {
  status: 'ok' | 'fail';
  checks: {
    db: 'ok' | 'fail';
    redis: 'ok' | 'fail';
    queue: 'ok' | 'fail';
  };
}

// Bounded so one dead dependency can't hang the whole readiness probe —
// an uptime monitor polling this needs a fast, deterministic answer.
const PROBE_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * [15.1.3]: the deep half of the health surface. Probes Postgres, Redis,
 * and the communications queue in parallel, each bounded to
 * `PROBE_TIMEOUT_MS` — a dependency that's merely slow must not make this
 * endpoint itself slow, since that's exactly the "readiness taking too
 * long" state an uptime monitor is watching for.
 *
 * Deliberately reports only `'ok' | 'fail'` per dependency — never the
 * underlying error message or hostname (see `HealthController`'s guard
 * for why: this route is reachable, behind a shared token, from outside
 * the cluster).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async readiness(): Promise<ReadinessResult> {
    const [db, redis, queue] = await Promise.all([
      this.probeDb(),
      this.probeRedis(),
      this.probeQueue(),
    ]);

    const status = db === 'ok' && redis === 'ok' && queue === 'ok' ? 'ok' : 'fail';
    return { status, checks: { db, redis, queue } };
  }

  private async probeDb(): Promise<'ok' | 'fail'> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), PROBE_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async probeRedis(): Promise<'ok' | 'fail'> {
    // A separate short-lived connection rather than a shared client — this
    // probe's whole point is to notice a Redis outage, so it must not
    // depend on a long-lived client that itself might be wedged waiting
    // for reconnection. lazyConnect + a hard timeout below keeps a dead
    // Redis from ever leaving a dangling connection behind.
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    try {
      await withTimeout(redis.ping(), PROBE_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'fail';
    } finally {
      redis.disconnect();
    }
  }

  private async probeQueue(): Promise<'ok' | 'fail'> {
    try {
      await withTimeout(this.queue.getJobCounts(), PROBE_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'fail';
    }
  }
}
