import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueWorkers } from '../common/queue-workers';

// What the worker switch held at the moment `app.module` was evaluated —
// that is when `BullModule.forRootAsync` reads it.
const seen = vi.hoisted(() => ({
  workersEnabledAtAppModuleLoad: undefined as boolean | undefined,
}));

vi.mock('../app.module', async () => {
  const { queueWorkers: switchAtLoad } = await import('../common/queue-workers');
  seen.workersEnabledAtAppModuleLoad = switchAtLoad.enabled;
  return { AppModule: class AppModule {} };
});

vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: vi.fn().mockResolvedValue({ fake: 'context' }) },
}));

// A fake Redis whose connection succeeds or fails on demand.
const redisState = vi.hoisted(() => ({ reachable: true }));
vi.mock('ioredis', () => ({
  default: class FakeRedis {
    connect() {
      return redisState.reachable ? Promise.resolve() : Promise.reject(new Error('ECONNREFUSED'));
    }
    ping() {
      return Promise.resolve('PONG');
    }
    on() {
      return this;
    }
    disconnect() {}
  },
}));

import { NestFactory } from '@nestjs/core';
import { assertRedisReachable, createScriptAppContext } from './script-app-context';

afterEach(() => {
  queueWorkers.enabled = true;
  redisState.reachable = true;
  vi.mocked(NestFactory.createApplicationContext).mockClear();
});

describe('createScriptAppContext', () => {
  it('turns BullMQ workers off BEFORE AppModule is loaded', async () => {
    const context = await createScriptAppContext();

    // If the switch flipped after app.module loaded, BullModule would already
    // have captured `manualRegistration: false` and the script would start
    // workers that pull jobs off a shared Redis.
    expect(seen.workersEnabledAtAppModuleLoad).toBe(false);
    expect(context).toEqual({ fake: 'context' });
  });

  it('refuses to boot when Redis is down instead of hanging', async () => {
    redisState.reachable = false;

    await expect(createScriptAppContext()).rejects.toThrow('Redis is not reachable');
    // The whole point: Nest never starts, so nothing sits retrying forever.
    expect(NestFactory.createApplicationContext).not.toHaveBeenCalled();
  });
});

describe('assertRedisReachable', () => {
  it('says how to fix it when Redis is down', async () => {
    redisState.reachable = false;

    await expect(assertRedisReachable('redis://127.0.0.1:6379')).rejects.toThrow(
      'Redis is not reachable at redis://127.0.0.1:6379 — start it with: docker compose up -d redis',
    );
  });

  it('never prints the password from a credentialed REDIS_URL', async () => {
    redisState.reachable = false;

    const error = await assertRedisReachable('redis://user:s3cret@redis.internal:6379').catch(
      (e: Error) => e,
    );

    expect(String(error)).not.toContain('s3cret');
    expect(String(error)).toContain('redis://***@redis.internal:6379');
  });

  it('passes when Redis answers', async () => {
    await expect(assertRedisReachable('redis://127.0.0.1:6379')).resolves.toBeUndefined();
  });
});
