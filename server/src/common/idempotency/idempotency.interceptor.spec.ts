import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { from, lastValueFrom, type Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Minimal in-memory Redis: SET (NX, PX/EX), GET, DEL. */
class FakeRedis {
  store = new Map<string, string>();
  async set(key: string, value: string, ...args: (string | number)[]) {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
}

function ctx(
  opts: { key?: unknown; tenant?: string; user?: string; url?: string; route?: string } = {},
) {
  const url = opts.url ?? '/api/communications/send';
  const request = {
    method: 'POST',
    originalUrl: url,
    path: url,
    route: { path: opts.route ?? '/communications/send' },
    headers: opts.key === undefined ? {} : { 'idempotency-key': opts.key },
    currentTenant: { id: opts.tenant ?? 't1' },
    user: { sub: opts.user ?? 'u1' },
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

async function run(
  interceptor: IdempotencyInterceptor,
  context: never,
  handler: () => Observable<unknown>,
) {
  const obs = await interceptor.intercept(context, { handle: handler });
  return lastValueFrom(obs);
}

describe('IdempotencyInterceptor [#2631]', () => {
  let redis: FakeRedis;
  let interceptor: IdempotencyInterceptor;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    redis = new FakeRedis();
    interceptor = new IdempotencyInterceptor(redis as never);
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes through with no header and touches no Redis state', async () => {
    const handler = vi.fn(() => of({ id: 1 }));
    expect(await run(interceptor, ctx(), handler)).toEqual({ id: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.store.size).toBe(0);
  });

  it('rejects a malformed key with 400 and never echoes the value', async () => {
    const bad = 'bad key <script>';
    const err = await interceptor.intercept(ctx({ key: bad }), { handle: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).not.toContain('script');
  });

  it('stores the first answer and replays it without calling the handler again', async () => {
    const handler = vi.fn(() => of({ id: 1 }));
    const first = await run(interceptor, ctx({ key: 'k1' }), handler);
    const second = await run(interceptor, ctx({ key: 'k1' }), handler);
    expect(second).toEqual(first);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('answers 409 while the first call is still in flight, then replays once it finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(() => from(gate.then(() => ({ id: 7 }))));
    const firstRun = run(interceptor, ctx({ key: 'k2' }), slow);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());

    await expect(
      interceptor.intercept(ctx({ key: 'k2' }), { handle: vi.fn() }),
    ).rejects.toBeInstanceOf(ConflictException);

    release();
    await firstRun;
    const handler = vi.fn(() => of({ id: 99 }));
    expect(await run(interceptor, ctx({ key: 'k2' }), handler)).toEqual({ id: 7 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('releases the key when the handler fails so a retry runs again', async () => {
    const failing = vi.fn(() => throwError(() => new Error('INSUFFICIENT_SMS_CREDIT')));
    await expect(run(interceptor, ctx({ key: 'k3' }), failing)).rejects.toThrow(
      'INSUFFICIENT_SMS_CREDIT',
    );
    const ok = vi.fn(() => of({ id: 2 }));
    expect(await run(interceptor, ctx({ key: 'k3' }), ok)).toEqual({ id: 2 });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('scopes the key by tenant and by user', async () => {
    const handler = vi.fn(() => of({ id: 1 }));
    await run(interceptor, ctx({ key: 'k4' }), handler);
    await run(interceptor, ctx({ key: 'k4', tenant: 't2' }), handler);
    await run(interceptor, ctx({ key: 'k4', user: 'u2' }), handler);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('[2683] scopes the key by the actual URL, not the route pattern', async () => {
    const handler = vi.fn(() => of({ sent: true }));
    const route = '/invoices/:id/send';
    await run(interceptor, ctx({ key: 'k6', url: '/api/invoices/aaa/send', route }), handler);
    await run(interceptor, ctx({ key: 'k6', url: '/api/invoices/bbb/send', route }), handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('[2683] treats a corrupt stored answer as a miss, deletes it and runs the handler', async () => {
    const first = vi.fn(() => of({ id: 1 }));
    await run(interceptor, ctx({ key: 'k7' }), first);
    const [storedKey] = [...redis.store.keys()];
    redis.store.set(storedKey, '{"body":');
    const handler = vi.fn(() => of({ id: 2 }));
    expect(await run(interceptor, ctx({ key: 'k7' }), handler)).toEqual({ id: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(redis.store.get(storedKey)!)).toEqual({ body: { id: 2 } });
  });

  it('runs the handler once and logs when Redis rejects every call', async () => {
    const dead = {
      set: vi.fn().mockRejectedValue(new Error('down')),
      get: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    };
    const broken = new IdempotencyInterceptor(dead as never);
    const handler = vi.fn(() => of({ id: 1 }));
    expect(await run(broken, ctx({ key: 'k5' }), handler)).toEqual({ id: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
    expect(String(errorLog.mock.calls[0][0])).not.toContain('k5');
  });
});
