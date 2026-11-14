import { describe, it, expect, vi } from 'vitest';
import { SmsCreditSummaryService } from './sms-credit-summary.service';
import { SmsCreditLot } from './entities/sms-credit-lot.entity';

const lot = (id: string, remaining: number, total: number, exp: string | null) => ({
  id,
  source: 'BUNDLE',
  units_total: total,
  remaining,
  expires_at: exp ? new Date(exp) : null,
  created_at: new Date('2026-01-01'),
});

function make(metering: string, lots: unknown[] = [], orders: unknown[] = []) {
  const ds = {
    getRepository: (e: unknown) => ({
      find: vi.fn().mockResolvedValue(e === SmsCreditLot ? lots : orders),
    }),
  };
  const schools = {
    getResolvedSettings: vi.fn().mockResolvedValue({ communications: { sms: { metering } } }),
  };
  return new SmsCreditSummaryService(ds as any, schools as any);
}

describe('SmsCreditSummaryService.forSchool', () => {
  it('metering OFF returns the zeroed shape', async () => {
    const r = await make('OFF', [lot('a', 5, 5, null)]).forSchool('t');
    expect(r).toEqual({
      lots: [],
      orders: [],
      source: 'OWN',
      almostFinished: false,
      stopped: false,
    });
  });

  it('sorts soonest expiry first, no-expiry last, and flags low balance', async () => {
    const r = await make('PLATFORM', [
      lot('never', 10, 100, null),
      lot('late', 10, 100, '2099-01-01'),
      lot('soon', 10, 100, '2098-01-01'),
    ]).forSchool('t');
    expect(r.lots.map((l) => l.id)).toEqual(['soon', 'late', 'never']);
    expect(r.source).toBe('SCHOOLMANAGERP');
    expect(r.almostFinished).toBe(true); // 30 left <= 100
    expect(r.stopped).toBe(false);
  });

  it('maps orders, receipt flag and paisa as a number', async () => {
    const r = await make(
      'PLATFORM',
      [],
      [
        {
          id: 'o',
          name_snapshot: 'Pack',
          sms_count: 500,
          price_paisa: '12000',
          status: 'PAID',
          paid_at: null,
          receipt_number: 'R-1',
        },
      ],
    ).forSchool('t');
    expect(r.orders[0]).toMatchObject({
      name: 'Pack',
      price_paisa: 12000,
      receipt_available: true,
    });
    expect(r.stopped).toBe(true); // no lots, zero remaining
  });
});
