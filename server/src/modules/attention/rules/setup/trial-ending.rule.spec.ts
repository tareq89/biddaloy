import { describe, it, expect, vi } from 'vitest';
import { AlertSeverity, SchoolStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { DAY_MS } from '../../../schools/trial/trial.constants';
import { render } from '../messages';
import type { RuleContext } from '../rule.types';
import { TrialEndingRule } from './trial-ending.rule';

const now = new Date('2026-10-01T00:00:00Z');
const ctx = { tenantId: 't1', now } as RuleContext;
const admin = (id: string, status = UserStatus.ACTIVE) => ({
  user_id: id,
  role: UserRole.ADMIN,
  user: { status },
});

function make(endsInMs: number | null, members: unknown[] = [admin('a1')], school = true) {
  const schools = {
    findOne: vi.fn().mockResolvedValue(
      school
        ? {
            id: 't1',
            status: SchoolStatus.ACTIVE,
            trial_ends_at: endsInMs === null ? null : new Date(now.getTime() + endsInMs),
          }
        : null,
    ),
  };
  const memberships = { find: vi.fn().mockResolvedValue(members) };
  return {
    rule: new TrialEndingRule(schools as never, memberships as never),
    schools,
    memberships,
  };
}

describe('TrialEndingRule', () => {
  it('raises nothing without a trial or an ACTIVE school', async () => {
    expect(await make(null).rule.evaluate(ctx)).toEqual([]);
    expect(await make(DAY_MS, [], false).rule.evaluate(ctx)).toEqual([]);
  });

  it('scopes both queries to the tenant (tenant isolation)', async () => {
    const { rule, schools, memberships } = make(DAY_MS);
    await rule.evaluate(ctx);
    expect(schools.findOne.mock.calls[0][0].where).toMatchObject({
      id: 't1',
      status: SchoolStatus.ACTIVE,
    });
    expect(memberships.find.mock.calls[0][0].where).toMatchObject({ tenant_id: 't1' });
  });

  it('is silent with 8 days left, WARNING at 7 and 3', async () => {
    expect(await make(8 * DAY_MS).rule.evaluate(ctx)).toEqual([]);
    const [f7] = await make(7 * DAY_MS).rule.evaluate(ctx);
    expect(f7.severity).toBe(AlertSeverity.WARNING);
    expect(f7.params.days).toBe(7);
    const [f3] = await make(3 * DAY_MS).rule.evaluate(ctx);
    expect(f3.severity).toBe(AlertSeverity.WARNING);
  });

  it('is CRITICAL at 2 days, the last hours (ceil to 1), and after the end date', async () => {
    const [f2] = await make(2 * DAY_MS).rule.evaluate(ctx);
    expect(f2.severity).toBe(AlertSeverity.CRITICAL);
    const [f1] = await make(5 * 3_600_000).rule.evaluate(ctx);
    expect(f1.severity).toBe(AlertSeverity.CRITICAL);
    expect(f1.params.days).toBe(1);
    const [f0] = await make(-3_600_000).rule.evaluate(ctx);
    expect(f0.severity).toBe(AlertSeverity.CRITICAL);
    expect(f0.params.days).toBe(0);
  });

  it('notifies only active ADMINs, one stable dedupe key, expires a day after the end', async () => {
    // The role filter (ADMIN only) is in the query; the fake returns what it would.
    const { rule } = make(3 * DAY_MS, [admin('a1'), admin('a2', UserStatus.SUSPENDED)]);
    const [f] = await rule.evaluate(ctx);
    expect(f.recipients).toEqual([{ userId: 'a1', role: UserRole.ADMIN }]);
    expect(f.dedupeKey).toBe('trial');
    expect(f.actionUrl).toBe('/dashboard?trial=1');
    expect(f.expiresAt).toEqual(new Date(now.getTime() + 4 * DAY_MS));
  });

  it('raises nothing when no active ADMIN exists', async () => {
    expect(await make(DAY_MS, [admin('a2', UserStatus.SUSPENDED)]).rule.evaluate(ctx)).toEqual([]);
  });

  it('renders Bangla digits in the bn title', () => {
    const { rule } = make(DAY_MS);
    expect(render(rule.messages, 'bn', { days: 5 }).title).toContain('৫');
  });
});
