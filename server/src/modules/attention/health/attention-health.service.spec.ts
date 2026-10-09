import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AlertCadence } from '@biddaloy/shared';
import { ATTENTION_SWEEP_DONE, attentionEvents } from '../attention.constants';
import { AttentionHealthService, heartbeatStatus } from './attention-health.service';
import { sentryCronCheckIn } from './sentry-cron';

vi.mock('./sentry-cron', () => ({ sentryCronCheckIn: vi.fn() }));

describe('heartbeatStatus', () => {
  const hb = JSON.stringify({ at: '2026-10-09T04:00:00Z' });

  it('is stale when missing or garbage', () => {
    expect(heartbeatStatus(null, new Date())).toBe('stale');
    expect(heartbeatStatus('not json', new Date())).toBe('stale');
  });

  it('is ok at exactly 15 minutes and stale one second later (D12)', () => {
    expect(heartbeatStatus(hb, new Date('2026-10-09T04:15:00Z'))).toBe('ok');
    expect(heartbeatStatus(hb, new Date('2026-10-09T04:15:01Z'))).toBe('stale');
  });

  it('is stale when a fresh sweep failed for every tenant, ok when only some failed', () => {
    const now = new Date('2026-10-09T04:01:00Z');
    const beat = (tenants: number, failures: number) =>
      JSON.stringify({ at: '2026-10-09T04:00:00Z', tenants, failures });
    expect(heartbeatStatus(beat(3, 3), now)).toBe('stale');
    expect(heartbeatStatus(beat(3, 1), now)).toBe('ok');
    expect(heartbeatStatus(beat(0, 0), now)).toBe('ok'); // no tenants yet is not a failure
  });
});

describe('AttentionHealthService', () => {
  const redis = { mget: vi.fn(), scan: vi.fn(), hgetall: vi.fn() };
  const config = { get: vi.fn().mockReturnValue('https://sentry.example/cron/x') };
  let service: AttentionHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue('https://sentry.example/cron/x');
    service = new AttentionHealthService(redis as never, config as never);
  });
  afterEach(() => service.onModuleDestroy());

  it('checks in to Sentry for a FAST sweep only', () => {
    service.onModuleInit();
    attentionEvents.emit(ATTENTION_SWEEP_DONE, { cadence: AlertCadence.HOURLY });
    expect(sentryCronCheckIn).not.toHaveBeenCalled();
    attentionEvents.emit(ATTENTION_SWEEP_DONE, { cadence: AlertCadence.FAST });
    expect(sentryCronCheckIn).toHaveBeenCalledWith('https://sentry.example/cron/x', 'ok');
  });

  it('returns null sweeps when heartbeats are absent', async () => {
    redis.mget.mockResolvedValue([null, null, null]);
    redis.scan.mockResolvedValue(['0', []]);
    const h = await service.getHealth();
    expect(h.lastSweep).toEqual({ FAST: null, HOURLY: null, DAILY: null });
    expect(h.durationsMs).toEqual({ FAST: null, HOURLY: null, DAILY: null });
    expect(h.failingRules).toEqual([]);
  });

  it('reads sweeps and sorts failing rules by count desc', async () => {
    redis.mget.mockResolvedValue([
      JSON.stringify({ at: '2026-10-09T04:00:00Z', durationMs: 120 }),
      null,
      null,
    ]);
    redis.scan.mockResolvedValue(['0', ['attention:failing:a.one', 'attention:failing:b.two']]);
    redis.hgetall.mockImplementation(async (k: string) =>
      k.endsWith('a.one') ? { count: '2', lastError: 'boom' } : { count: '9', lastError: 'bang' },
    );
    const h = await service.getHealth();
    expect(h.lastSweep.FAST).toBe('2026-10-09T04:00:00Z');
    expect(h.durationsMs.FAST).toBe(120);
    expect(h.failingRules.map((r) => r.key)).toEqual(['b.two', 'a.one']);
  });

  it('follows the SCAN cursor past an empty first page and drops expired keys', async () => {
    redis.mget.mockResolvedValue([null, null, null]);
    redis.scan
      .mockResolvedValueOnce(['7', []])
      .mockResolvedValueOnce(['0', ['attention:failing:a.one', 'attention:failing:gone']]);
    redis.hgetall.mockImplementation(async (k: string) =>
      k.endsWith('a.one') ? { count: '2', lastError: 'boom' } : {},
    );
    const h = await service.getHealth();
    expect(redis.scan).toHaveBeenCalledTimes(2);
    expect(h.failingRules.map((r) => r.key)).toEqual(['a.one']);
  });

  it('maps Redis errors to 503', async () => {
    redis.mget.mockRejectedValue(new Error('down'));
    await expect(service.getHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
