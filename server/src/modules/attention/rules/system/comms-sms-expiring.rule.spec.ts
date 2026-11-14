import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { RuleContext } from '../rule.types';
import { CommsSmsExpiringRule } from './comms-sms-expiring.rule';

const NOW = new Date('2026-10-10T05:00:00Z');
const ctx: RuleContext = {
  tenantId: 'T',
  now: NOW,
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '11:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
};
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

const make = (metered: boolean, lots: { expires_at: Date; remaining: number }[]) => {
  const ds = {
    query: vi
      .fn()
      .mockResolvedValueOnce(lots)
      .mockResolvedValueOnce([{ userId: 'a1', role: UserRole.ADMIN }]),
  };
  const credits = { isMetered: vi.fn().mockResolvedValue(metered) };
  return { rule: new CommsSmsExpiringRule(ds as never, credits as never), ds };
};

describe('CommsSmsExpiringRule', () => {
  it('uses the catalogue meta', () => {
    expect(make(true, []).rule.meta).toEqual(alertRuleMeta('sms.expiring'));
  });

  it('gives nothing to an unmetered school', async () => {
    const { rule, ds } = make(false, [{ expires_at: inDays(2), remaining: 50 }]);
    expect(await rule.evaluate(ctx)).toEqual([]);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('gives nothing when no lot with credit expires within 7 days (remaining 0 is excluded in SQL)', async () => {
    const { rule, ds } = make(true, []);
    expect(await rule.evaluate(ctx)).toEqual([]);
    expect(ds.query.mock.calls[0][0]).toContain('remaining > 0');
  });

  it('is amber at 7 days', async () => {
    const [f] = await make(true, [{ expires_at: inDays(7), remaining: 40 }]).rule.evaluate(ctx);
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.actionUrl).toBe('/settings?section=communication&smsBuy=1');
  });

  it('is red at 1 day', async () => {
    const [f] = await make(true, [{ expires_at: inDays(1), remaining: 40 }]).rule.evaluate(ctx);
    expect(f.severity).toBe(AlertSeverity.CRITICAL);
  });

  it("gives one finding with the soonest date and only that date's credit", async () => {
    const lots = [
      { expires_at: inDays(2), remaining: 30 },
      { expires_at: inDays(2), remaining: 20 },
      { expires_at: inDays(5), remaining: 99 },
    ];
    const found = await make(true, lots).rule.evaluate(ctx);
    expect(found).toHaveLength(1);
    expect(found[0].params).toEqual({ remaining: 50, date: '2026-10-12' });
    expect(found[0].dedupeKey).toBe('school:T');
  });

  it('sends only to ADMINs and scopes lots to the tenant', async () => {
    const { rule, ds } = make(true, [{ expires_at: inDays(2), remaining: 5 }]);
    const [f] = await rule.evaluate(ctx);
    expect(f.recipients).toEqual([{ userId: 'a1', role: UserRole.ADMIN }]);
    expect(ds.query.mock.calls[0][1][0]).toBe('T');
    expect(ds.query.mock.calls[1][1]).toEqual(['T', [UserRole.ADMIN]]);
  });
});
