import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { IMPERSONATION_RATE_LIMIT } from '../../../support-access/sessions/impersonation-session.service';
import { PlatformLoginAsBurstRule } from './platform-login-as-burst.rule';

const PID = 'platform';
const NOW = new Date('2026-11-12T06:00:00Z');
const ctx = (tenantId = PID): RuleContext => ({
  tenantId,
  now: NOW,
  tz: 'Asia/Dhaka',
  localDate: '2026-11-12',
  localTime: '12:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
});
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const resolver = (pid: string | undefined) => ({ resolve: async () => pid }) as never;

/** Recipient query (user_tenants) returns the owners who are not excluded; the other returns bursts. */
function make(bursts: unknown[], otherOwners: unknown[] = [{ userId: 'o2' }], pid = PID) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? otherOwners : bursts,
    );
  return { rule: new PlatformLoginAsBurstRule({ query } as never, resolver(pid)), query };
}

describe('PlatformLoginAsBurstRule', () => {
  it('has the catalogue meta and sane bn/en messages', () => {
    const { rule } = make([]);
    expect(rule.meta).toEqual(alertRuleMeta('platform.login_as_burst'));
    for (const lang of ['en', 'bn'] as const) {
      const m = rule.messages[lang];
      expect(m.steps.length).toBeLessThanOrEqual(3);
      for (const p of [m.title, m.why, ...m.steps, m.action ?? ''].flatMap(placeholders)) {
        expect(['owner', 'count']).toContain(p);
      }
    }
  });

  it('is silent on any school except the platform tenant, with no query', async () => {
    const { rule, query } = make([{ ownerId: 'o1', owner: 'Rafi', n: 12 }]);
    expect(await rule.evaluate(ctx('school-a'))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('is silent when the platform tenant is unresolved', async () => {
    const query = vi.fn();
    const rule = new PlatformLoginAsBurstRule({ query } as never, resolver(undefined));
    expect(await rule.evaluate(ctx())).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('threshold is the Login as rate limit (10), 1 h window from ctx.now, bound not hardcoded', async () => {
    const { rule, query } = make([]);
    await rule.evaluate(ctx());
    const [sql, params] = query.mock.calls[0];
    expect(IMPERSONATION_RATE_LIMIT).toBe(10);
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain('HAVING count(*) >= $2');
    expect(params).toEqual([NOW, IMPERSONATION_RATE_LIMIT]);
  });

  it('no owner at or over the limit gives nothing', async () => {
    expect(await make([]).rule.evaluate(ctx())).toEqual([]);
  });

  it('one finding per bursting owner, first name and count only', async () => {
    const { rule } = make([
      { ownerId: 'o1', owner: 'Rafi', n: 10 },
      { ownerId: 'o3', owner: 'Mina', n: 14 },
    ]);
    const out = await rule.evaluate(ctx());
    expect(out.map((f) => f.dedupeKey)).toEqual([
      'platform:login_as_burst:o1',
      'platform:login_as_burst:o3',
    ]);
    expect(out[0].params).toEqual({ owner: 'Rafi', count: 10 });
    expect(out[0].recipients).toEqual([{ userId: 'o2', role: UserRole.SUPER_ADMIN }]);
  });

  it('recipient query excludes the bursting owner and locked owners', async () => {
    const { rule, query } = make([{ ownerId: 'o1', owner: 'Rafi', n: 11 }]);
    await rule.evaluate(ctx());
    const call = query.mock.calls.find((c) => String(c[0]).includes('FROM user_tenants'))!;
    // The caused-it owner is excluded by id; locked admins by the join condition.
    expect(call[0]).toContain('ut.user_id <> $2');
    expect(call[0]).toContain('pa.locked_at IS NULL');
    expect(call[1]).toEqual([PID, 'o1']);
  });

  it('skips the finding when nobody else can be told', async () => {
    const { rule } = make([{ ownerId: 'o1', owner: 'Rafi', n: 11 }], []);
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('params carry no secrets, reason text or ids beyond owner and count', async () => {
    const { rule } = make([
      { ownerId: 'o1', owner: 'Rafi', n: 11, reason: 'SECRET', email: 'x@y.z' },
    ]);
    const [f] = await rule.evaluate(ctx());
    expect(Object.keys(f.params).sort()).toEqual(['count', 'owner']);
    expect(JSON.stringify(f)).not.toContain('SECRET');
  });
});
