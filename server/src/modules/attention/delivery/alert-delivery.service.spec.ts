import { describe, it, expect, vi } from 'vitest';
import { AlertDeliveryService, isInQuietHours, quietHoursEnd } from './alert-delivery.service';

const wrap = { start: '21:00', end: '07:00' };

describe('isInQuietHours', () => {
  it('wrapping window covers the evening and the early morning, end is exclusive', () => {
    expect(isInQuietHours('21:00', wrap)).toBe(true);
    expect(isInQuietHours('06:59', wrap)).toBe(true);
    expect(isInQuietHours('07:00', wrap)).toBe(false);
    expect(isInQuietHours('20:59', wrap)).toBe(false);
  });

  it('non-wrapping window is [start, end)', () => {
    const q = { start: '13:00', end: '14:00' };
    expect(isInQuietHours('13:30', q)).toBe(true);
    expect(isInQuietHours('14:00', q)).toBe(false);
  });

  it('start === end means never quiet', () => {
    expect(isInQuietHours('21:00', { start: '21:00', end: '21:00' })).toBe(false);
  });
});

describe('quietHoursEnd (Asia/Dhaka)', () => {
  it('evening instant ends at 07:00 the next local day', () => {
    // 22:00 Dhaka on Oct 9 -> 07:00 Dhaka on Oct 10 = 01:00Z
    const end = quietHoursEnd(new Date('2026-10-09T16:00:00Z'), 'Asia/Dhaka', wrap);
    expect(end.toISOString()).toBe('2026-10-10T01:00:00.000Z');
  });

  it('after-midnight instant ends the same local day (midnight boundary)', () => {
    // 00:30 Dhaka on Oct 10 -> 07:00 Dhaka on Oct 10
    const end = quietHoursEnd(new Date('2026-10-09T18:30:00Z'), 'Asia/Dhaka', wrap);
    expect(end.toISOString()).toBe('2026-10-10T01:00:00.000Z');
  });
});

describe('AlertDeliveryService.catchUp', () => {
  it('delivers the stale unpushed recipients it finds, grouped per tenant', async () => {
    const query = vi.fn(async () => [
      { id: 'r1', tenant_id: 'ta' },
      { id: 'r2', tenant_id: 'tb' },
      { id: 'r3', tenant_id: 'ta' },
    ]);
    const svc = new AlertDeliveryService(
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const deliver = vi.spyOn(svc, 'deliver').mockResolvedValue();
    const now = new Date('2026-10-09T04:00:00Z');
    await svc.catchUp(now);

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/pushed_at IS NULL/);
    expect(sql).toMatch(/a\.status = 'ACTIVE'/);
    expect(sql).toMatch(/interval '2 minutes'/);
    expect(params[0]).toBe(now);
    expect(deliver).toHaveBeenCalledWith('ta', ['r1', 'r3'], now);
    expect(deliver).toHaveBeenCalledWith('tb', ['r2'], now);
  });

  it('one failing tenant does not stop the rest', async () => {
    const query = vi.fn(async () => [
      { id: 'r1', tenant_id: 'ta' },
      { id: 'r2', tenant_id: 'tb' },
    ]);
    const svc = new AlertDeliveryService(
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const deliver = vi
      .spyOn(svc, 'deliver')
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue();
    await svc.catchUp();
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
