import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertSeverity, UserRole } from '@biddaloy/shared';
import { render } from '../messages';
import type { RuleContext } from '../rule.types';
import { SeatsExhaustedRule } from './seats-exhausted.rule';
import { SeatsExpiringRule } from './seats-expiring.rule';

// School-local date is 2026-10-10.
const ctx = { tenantId: 't1', localDate: '2026-10-10' } as RuleContext;

// Billing started long ago unless a test says otherwise.
const originalFreeUntil = process.env.BILLING_FREE_UNTIL;
beforeEach(() => {
  process.env.BILLING_FREE_UNTIL = '2026-01-01T00:00:00+06:00';
});
afterEach(() => {
  if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
  else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
});

/**
 * Fake DataSource. `snap` null = the school is not ACTIVE. `entitled` null = `seat_limit` NULL
 * (the free period). `period_end` null = no PAID order; `days` = that order's length.
 * The recipient query returns the given admins.
 */
function ds(
  snap: {
    entitled: number | null;
    used: number;
    period_end: string | null;
    days?: number;
  } | null,
  admins = [{ userId: 'a1' }],
) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('FROM user_tenants')) return admins;
    if (sql.includes('FROM seat_orders')) {
      return snap?.period_end
        ? [{ period_end: snap.period_end, seats: snap.entitled ?? 0, days: snap.days ?? 180 }]
        : [];
    }
    return snap ? [{ seat_limit: snap.entitled, used: snap.used }] : [];
  });
  return { query };
}

describe('SeatsExpiringRule', () => {
  const run = (snap: Parameters<typeof ds>[0], admins?: { userId: string }[]) =>
    new SeatsExpiringRule(ds(snap, admins) as never).evaluate(ctx);

  it('is silent for a school that is not ACTIVE', async () => {
    expect(await run(null)).toEqual([]);
  });

  it('counts a school that never paid down to BILLING_FREE_UNTIL', async () => {
    process.env.BILLING_FREE_UNTIL = '2026-11-10T00:00:00+06:00'; // 31 days out
    expect(await run({ entitled: null, used: 5, period_end: null })).toEqual([]);
    process.env.BILLING_FREE_UNTIL = '2026-11-09T00:00:00+06:00'; // 30 days out
    const [f] = await run({ entitled: null, used: 5, period_end: null });
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.params).toMatchObject({ days: 30, date: '2026-11-09', entitled: 0 });
    // After the free period it stays CRITICAL with 0 days left, like an ended paid period.
    process.env.BILLING_FREE_UNTIL = '2026-10-01T00:00:00+06:00';
    const [after] = await run({ entitled: 0, used: 5, period_end: null });
    expect(after.severity).toBe(AlertSeverity.CRITICAL);
    expect(after.params.days).toBe(0);
  });

  it('gives an order of 31 days or less no 30-day warning, only the 7-day one', async () => {
    const short = { entitled: 100, used: 10, days: 31 };
    expect(await run({ ...short, period_end: '2026-11-09' })).toEqual([]);
    const [f7] = await run({ ...short, period_end: '2026-10-17' });
    expect(f7.severity).toBe(AlertSeverity.CRITICAL);
  });

  it('is silent 31 days out, WARNING at 30, CRITICAL at 7', async () => {
    expect(await run({ entitled: 100, used: 10, period_end: '2026-11-10' })).toEqual([]);
    const [f30] = await run({ entitled: 100, used: 10, period_end: '2026-11-09' });
    expect(f30.severity).toBe(AlertSeverity.WARNING);
    expect(f30.params.days).toBe(30);
    const [f7] = await run({ entitled: 100, used: 10, period_end: '2026-10-17' });
    expect(f7.severity).toBe(AlertSeverity.CRITICAL);
  });

  it('warns at 90 % used even with the end date far away', async () => {
    expect(await run({ entitled: 100, used: 89, period_end: '2027-01-01' })).toEqual([]);
    const [f] = await run({ entitled: 100, used: 90, period_end: '2027-01-01' });
    expect(f.severity).toBe(AlertSeverity.WARNING);
  });

  it('stays CRITICAL after the end date, with 0 days left', async () => {
    const [f] = await run({ entitled: 0, used: 4, period_end: '2026-10-08' });
    expect(f.severity).toBe(AlertSeverity.CRITICAL);
    expect(f.params.days).toBe(0);
  });

  it('leaves a full school to seats.exhausted', async () => {
    expect(await run({ entitled: 10, used: 10, period_end: '2026-10-12' })).toEqual([]);
  });

  it('dedupes per period_end, so a renewal starts a new alert; goes to active ADMINs', async () => {
    const [a] = await run({ entitled: 10, used: 1, period_end: '2026-10-12' });
    const [b] = await run({ entitled: 10, used: 1, period_end: '2026-11-09' });
    expect(a.dedupeKey).toBe('seats:2026-10-12');
    expect(b.dedupeKey).toBe('seats:2026-11-09');
    expect(a.actionUrl).toBe('/settings?section=billing');
    expect(a.recipients).toEqual([{ userId: 'a1', role: UserRole.ADMIN }]);
  });

  it('raises nothing when no active ADMIN exists, and scopes its queries to the tenant', async () => {
    expect(await run({ entitled: 10, used: 1, period_end: '2026-10-12' }, [])).toEqual([]);
    const d = ds({ entitled: 10, used: 1, period_end: '2026-10-12' });
    await new SeatsExpiringRule(d as never).evaluate(ctx);
    for (const call of d.query.mock.calls) expect(call[1][0]).toBe('t1');
  });

  it('renders Bangla digits in the bn title', () => {
    const rule = new SeatsExpiringRule({} as never);
    expect(
      render(rule.messages, 'bn', { days: 5, used: 1, entitled: 2, date: 'x' }).title,
    ).toContain('৫');
  });
});

describe('SeatsExhaustedRule', () => {
  const run = (snap: Parameters<typeof ds>[0]) =>
    new SeatsExhaustedRule(ds(snap) as never).evaluate(ctx);

  it('is silent in the free period and while a seat is free', async () => {
    expect(await run(null)).toEqual([]);
    process.env.BILLING_FREE_UNTIL = '2027-01-01T00:00:00+06:00';
    expect(await run({ entitled: null, used: 50, period_end: null })).toEqual([]);
    process.env.BILLING_FREE_UNTIL = '2026-01-01T00:00:00+06:00';
    expect(await run({ entitled: 10, used: 9, period_end: '2027-01-01' })).toEqual([]);
  });

  it('is silent for an empty school with no seats', async () => {
    expect(await run({ entitled: 0, used: 0, period_end: null })).toEqual([]);
  });

  it('leaves an expired period to seats.expiring (no double bar)', async () => {
    expect(await run({ entitled: 0, used: 5, period_end: '2026-10-08' })).toEqual([]);
    expect(await run({ entitled: 0, used: 5, period_end: '2026-10-10' })).toEqual([]);
  });

  it('is CRITICAL when used reaches entitled, or passes it after the cutoff', async () => {
    const [full] = await run({ entitled: 10, used: 10, period_end: '2027-01-01' });
    expect(full.severity).toBe(AlertSeverity.CRITICAL);
    expect(full.dedupeKey).toBe('seats:exhausted');
    const [over] = await run({ entitled: 5, used: 7, period_end: '2027-01-01' });
    expect(over.params).toEqual({ used: 7, entitled: 5 });
  });
});
