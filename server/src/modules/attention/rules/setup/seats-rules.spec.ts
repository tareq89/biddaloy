import { describe, it, expect, vi } from 'vitest';
import { AlertSeverity, UserRole } from '@biddaloy/shared';
import { render } from '../messages';
import type { RuleContext } from '../rule.types';
import { SeatsExhaustedRule } from './seats-exhausted.rule';
import { SeatsExpiringRule } from './seats-expiring.rule';

// School-local date is 2026-10-10.
const ctx = { tenantId: 't1', localDate: '2026-10-10' } as RuleContext;

/**
 * Fake DataSource: the snapshot query returns `snap` (null = the school is not ACTIVE, or
 * `seat_limit` is NULL i.e. the free period); the recipient query returns the given admins.
 */
function ds(
  snap: { entitled: number; used: number; period_end: string | null } | null,
  admins = [{ userId: 'a1' }],
) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? admins : snap ? [snap] : [],
    );
  return { query };
}

describe('SeatsExpiringRule', () => {
  const run = (snap: Parameters<typeof ds>[0], admins?: { userId: string }[]) =>
    new SeatsExpiringRule(ds(snap, admins) as never).evaluate(ctx);

  it('is silent in the free period and for a school that never bought seats', async () => {
    expect(await run(null)).toEqual([]);
    expect(await run({ entitled: 0, used: 0, period_end: null })).toEqual([]);
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
    const [over] = await run({ entitled: 0, used: 3, period_end: null });
    expect(over.params).toEqual({ used: 3, entitled: 0 });
  });
});
