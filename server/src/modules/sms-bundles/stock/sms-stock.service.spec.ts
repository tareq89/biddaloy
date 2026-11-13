import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SmsStockService } from './sms-stock.service';

const make = (rows: unknown[] = []) => {
  const ds = { query: vi.fn().mockResolvedValue(rows) };
  return { ds, svc: new SmsStockService(ds as never, {} as never, {} as never) };
};

describe('SmsStockService (unit)', () => {
  it('weighted average is the SQL answer as a number (one or several entries)', async () => {
    const { svc, ds } = make([{ avg: '25' }]);
    expect(await svc.weightedAverageCostPaisaPerSms()).toBe(25);
    // Soft-deleted rows must never count.
    expect(ds.query.mock.calls[0][0]).toContain('deleted_at IS NULL');
  });

  it('weighted average is null when there are no entries', async () => {
    expect(await make([{ avg: null }]).svc.weightedAverageCostPaisaPerSms()).toBeNull();
  });

  it('list filters deleted rows and clamps the limit to 100', async () => {
    const { svc, ds } = make([]);
    await svc.list(9999);
    expect(ds.query.mock.calls[0][0]).toContain('deleted_at IS NULL');
    expect(ds.query.mock.calls[0][1][2]).toBe(101);
  });

  it('a malformed cursor is a 400 and runs no query', async () => {
    const { svc, ds } = make();
    await expect(svc.list(10, 'not-a-cursor')).rejects.toBeInstanceOf(BadRequestException);
    expect(ds.query).not.toHaveBeenCalled();
  });
});
