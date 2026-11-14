import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { PlatformSmsOversoldRule } from './platform-sms-oversold.rule';
import { PlatformSmsStockLowRule } from './platform-sms-stock-low.rule';

const PID = 'platform';
const ctx = (tenantId = PID): RuleContext => ({
  tenantId,
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
});
const ds = () => ({
  query: vi.fn().mockResolvedValue([{ userId: 'sa1' }]),
});
const resolver = (pid: string | undefined) => ({ resolve: async () => pid }) as never;
const make = (
  balance: { sms: number | null; stale?: boolean },
  promised: number,
  pid: string | null = PID,
) => {
  const d = ds();
  const reader = { read: vi.fn().mockResolvedValue({ stale: false, ...balance }) } as never;
  const allocation = { promisedUnused: vi.fn().mockResolvedValue(promised) } as never;
  return {
    d,
    low: new PlatformSmsStockLowRule(d as never, resolver(pid ?? undefined), reader, allocation),
    oversold: new PlatformSmsOversoldRule(
      d as never,
      resolver(pid ?? undefined),
      reader,
      allocation,
    ),
  };
};
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('platform SMS rules', () => {
  for (const key of ['low', 'oversold'] as const) {
    it(`${key}: catalogue meta, matching bn/en placeholders, at most 3 steps`, () => {
      const rule = make({ sms: 1 }, 0)[key];
      expect(rule.meta).toEqual(
        alertRuleMeta(key === 'low' ? 'platform.sms.stock_low' : 'platform.sms.oversold'),
      );
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why)).toEqual(placeholders(bn.title + bn.why));
      expect(en.steps.length).toBeLessThanOrEqual(3);
    });
    it(`${key}: another school or no platform school gets nothing, with no query`, async () => {
      const a = make({ sms: 0 }, 99);
      expect(await a[key].evaluate(ctx('school-a'))).toEqual([]);
      const b = make({ sms: 0 }, 99, null);
      expect(await b[key].evaluate(ctx())).toEqual([]);
      expect(a.d.query).not.toHaveBeenCalled();
      expect(b.d.query).not.toHaveBeenCalled();
    });
  }

  it('stock_low: fires below promised + 10%, not at it', async () => {
    const [f] = await make({ sms: 1000 }, 950).low.evaluate(ctx());
    expect(f.params).toEqual({ stock: 1000, promised: 950 });
    expect(f.dedupeKey).toBe('platform:sms-stock');
    expect(f.recipients).toEqual([{ userId: 'sa1', role: UserRole.SUPER_ADMIN }]);
    expect(await make({ sms: 1044 }, 950).low.evaluate(ctx())).toHaveLength(1);
    expect(await make({ sms: 1045 }, 950).low.evaluate(ctx())).toEqual([]);
  });
  it('stock_low: an old entered figure fires; an unknown balance does not', async () => {
    expect(await make({ sms: 5000, stale: true }, 10).low.evaluate(ctx())).toHaveLength(1);
    expect(await make({ sms: null }, 10).low.evaluate(ctx())).toEqual([]);
  });
  it('stock_low: nothing sold and nothing in stock is quiet', async () => {
    expect(await make({ sms: 0 }, 0).low.evaluate(ctx())).toEqual([]);
  });

  it('oversold: fires when promised is above stock, quiet at equal, quiet when unknown', async () => {
    const [f] = await make({ sms: 100 }, 101).oversold.evaluate(ctx());
    expect(f.dedupeKey).toBe('platform:sms-oversold');
    expect(await make({ sms: 100 }, 100).oversold.evaluate(ctx())).toEqual([]);
    expect(await make({ sms: null }, 999).oversold.evaluate(ctx())).toEqual([]);
  });
  it('both stay quiet when no platform admin can receive them', async () => {
    const m = make({ sms: 0 }, 99);
    m.d.query.mockResolvedValue([]);
    expect(await m.low.evaluate(ctx())).toEqual([]);
    expect(await m.oversold.evaluate(ctx())).toEqual([]);
  });
});
