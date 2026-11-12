import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import type { RuleContext } from '../rule.types';
import { SupportAccessRequestRule } from './support-access-request.rule';

const NOW = new Date('2026-11-12T06:00:00Z');
const ctx: RuleContext = {
  tenantId: 'school-a',
  now: NOW,
  tz: 'Asia/Dhaka',
  localDate: '2026-11-12',
  localTime: '12:00',
  isWorkingDay: true,
  settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
};
const ADMINS = [{ userId: 'a1', role: UserRole.ADMIN }];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** First query = request rows, second = admin recipients. */
function make(rows: unknown[], admins: unknown[] = ADMINS) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) => (sql.includes('FROM user_tenants') ? admins : rows));
  return { rule: new SupportAccessRequestRule({ query } as never), query };
}

describe('SupportAccessRequestRule', () => {
  it('has the catalogue meta and sane bn/en messages', () => {
    const { rule } = make([]);
    expect(rule.meta).toEqual(alertRuleMeta('support.access_request'));
    for (const lang of ['en', 'bn'] as const) {
      const m = rule.messages[lang];
      expect(m.steps.length).toBeLessThanOrEqual(3);
      for (const p of [m.title, m.why, ...m.steps, m.action ?? ''].flatMap(placeholders)) {
        expect(['owner', 'role']).toContain(p);
      }
    }
  });

  it('no request rows gives no finding', async () => {
    expect(await make([]).rule.evaluate(ctx)).toEqual([]);
  });

  it('a REQUESTED row gives one finding to the admins, with first name and role only', async () => {
    const { rule } = make([{ id: 'r1', owner: 'Rafi', role: 'TEACHER' }]);
    expect(await rule.evaluate(ctx)).toEqual([
      {
        dedupeKey: 'support:request:r1',
        subject: { type: 'support_request', id: 'r1' },
        params: { owner: 'Rafi', role: 'TEACHER' },
        actionUrl: '/support-access/requests/r1',
        recipients: ADMINS,
      },
    ]);
  });

  it('params never carry the reason or any other column', async () => {
    const { rule } = make([
      { id: 'r1', owner: 'Rafi', role: 'ADMIN', reason: 'SECRET', phone: '1' },
    ]);
    const [f] = await rule.evaluate(ctx);
    expect(Object.keys(f.params).sort()).toEqual(['owner', 'role']);
    expect(JSON.stringify(f)).not.toContain('SECRET');
  });

  it('gives no finding when the school has no active admin', async () => {
    expect(await make([{ id: 'r1', owner: 'Rafi', role: 'ADMIN' }], []).rule.evaluate(ctx)).toEqual(
      [],
    );
  });

  it('asks the database for NORMAL REQUESTED rows of this school only, 24 h back from ctx.now', async () => {
    const { rule, query } = make([]);
    await rule.evaluate(ctx);
    const [sql, params] = query.mock.calls[0];
    // The 24 h window and entry_kind live in SQL; expired and EMERGENCY rows never come back.
    expect(sql).toContain("s.status = 'REQUESTED'");
    expect(sql).toContain("s.entry_kind = 'NORMAL'");
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain('s.tenant_id = $1');
    expect(params).toEqual(['school-a', NOW]);
  });

  it('recipient query is tenant-scoped (another school never gets the alert)', async () => {
    const { rule, query } = make([{ id: 'r1', owner: 'Rafi', role: 'ADMIN' }]);
    await rule.evaluate({ ...ctx, tenantId: 'school-b' });
    const recipientCall = query.mock.calls.find((c) => String(c[0]).includes('FROM user_tenants'))!;
    expect(recipientCall[1][0]).toBe('school-b');
    expect(recipientCall[1][1]).toEqual(rule.meta.roles);
  });
});
