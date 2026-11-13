import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { RuleContext } from '../rule.types';
import { CommsSmsLowRule } from './comms-sms-low.rule';

const ctx: RuleContext = {
  tenantId: 'T',
  now: new Date('2026-10-10T05:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '11:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
};
const ADMIN_ROWS = [{ userId: 'a1', role: UserRole.ADMIN }];

// One lot of `total` with `remaining` left; the first query is the lots, the second the admins.
const make = (metered: boolean, lots: { units_total: number; remaining: number }[]) => {
  const ds = { query: vi.fn().mockResolvedValueOnce(lots).mockResolvedValueOnce(ADMIN_ROWS) };
  const credits = { isMetered: vi.fn().mockResolvedValue(metered) };
  return { rule: new CommsSmsLowRule(ds as never, credits as never), ds };
};

describe('CommsSmsLowRule', () => {
  it('uses the catalogue meta: ADMIN only, critical', () => {
    const { rule } = make(true, []);
    expect(rule.meta).toEqual(alertRuleMeta('sms.low'));
    expect(rule.meta.roles).toEqual([UserRole.ADMIN]);
  });

  it('gives nothing to an unmetered school and reads no lots', async () => {
    const { rule, ds } = make(false, [{ units_total: 1000, remaining: 0 }]);
    expect(await rule.evaluate(ctx)).toEqual([]);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('fires at 100 remaining, not at 101 (10% of 1000 is also 100)', async () => {
    const [f] = await make(true, [{ units_total: 1000, remaining: 100 }]).rule.evaluate(ctx);
    expect(f.params).toEqual({ remaining: 100, stopped: 0 });
    expect(f.actionUrl).toBe('/settings?section=communication&smsBuy=1');
    expect(f.dedupeKey).toBe('school:T');
    expect(await make(true, [{ units_total: 1000, remaining: 101 }]).rule.evaluate(ctx)).toEqual(
      [],
    );
  });

  it('fires under 10% of a large package (1200 of 20000)', async () => {
    const [f] = await make(true, [{ units_total: 20000, remaining: 1200 }]).rule.evaluate(ctx);
    expect(f.params).toEqual({ remaining: 1200, stopped: 0 });
  });

  it('flags zero as stopped', async () => {
    const [f] = await make(true, []).rule.evaluate(ctx);
    expect(f.params).toEqual({ remaining: 0, stopped: 1 });
  });

  it('sends only to ADMINs (the query is bound to meta.roles)', async () => {
    const { rule, ds } = make(true, []);
    const [f] = await rule.evaluate(ctx);
    expect(f.recipients).toEqual([{ userId: 'a1', role: UserRole.ADMIN }]);
    expect(ds.query.mock.calls[1][1]).toEqual(['T', [UserRole.ADMIN]]);
  });

  it('scopes the lot read to the tenant', async () => {
    const { rule, ds } = make(true, []);
    await rule.evaluate(ctx);
    expect(ds.query.mock.calls[0][1]).toEqual(['T', ctx.now]);
  });
});
