import { describe, it, expect, vi } from 'vitest';
import { AlertSeverity, SchoolStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { DAY_MS } from '../../../schools/trial/trial.constants';
import { render } from '../messages';
import type { RuleContext } from '../rule.types';
import { AccountIdleRule } from './account-idle.rule';

const now = new Date('2026-10-30T00:00:00Z');
const ctx = { tenantId: 't1', now } as RuleContext;
const admin = (id: string, status = UserStatus.ACTIVE) => ({
  user_id: id,
  role: UserRole.ADMIN,
  user: { status },
});

/** `ageDays` = days since the school was created; `students` = ACTIVE students it has. */
function make(
  ageDays: number,
  opts: {
    students?: number;
    members?: unknown[];
    school?: boolean;
    paid?: boolean;
    platformId?: string;
  } = {},
) {
  const { students = 0, members = [admin('a1')], school = true, paid = false } = opts;
  const manager = {
    // getSeatUsage runs a seat_limit read and then a count(*) read.
    query: vi.fn(async (sql: string) => {
      if (sql.includes('seat_orders')) return paid ? [{ '?column?': 1 }] : [];
      return sql.includes('count(*)') ? [{ n: String(students) }] : [{ seat_limit: null }];
    }),
  };
  const schools = {
    manager,
    findOne: vi.fn().mockResolvedValue(
      school
        ? {
            id: 't1',
            status: SchoolStatus.ACTIVE,
            created_at: new Date(now.getTime() - ageDays * DAY_MS),
            status_changed_at: null,
          }
        : null,
    ),
  };
  const memberships = { find: vi.fn().mockResolvedValue(members) };
  return {
    rule: new AccountIdleRule(
      schools as never,
      memberships as never,
      {
        platformTenantId: vi.fn().mockResolvedValue(opts.platformId ?? 'platform'),
      } as never,
    ),
    schools,
    memberships,
  };
}

describe('AccountIdleRule', () => {
  it('raises nothing on day 19', async () => {
    expect(await make(19).rule.evaluate(ctx)).toEqual([]);
  });

  it('is WARNING on day 20 with 10 days left and links to the add-student page', async () => {
    const [f] = await make(20).rule.evaluate(ctx);
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.params.days).toBe(10);
    expect(f.actionUrl).toBe('/students/new');
    expect(f.dedupeKey).toBe('idle');
  });

  it('is CRITICAL from day 27', async () => {
    const [f] = await make(27).rule.evaluate(ctx);
    expect(f.severity).toBe(AlertSeverity.CRITICAL);
    expect(f.params.days).toBe(3);
  });

  it('raises nothing once the school has a student', async () => {
    expect(await make(25, { students: 1 }).rule.evaluate(ctx)).toEqual([]);
  });

  it('raises nothing for the platform tenant', async () => {
    expect(await make(25, { platformId: 't1' }).rule.evaluate(ctx)).toEqual([]);
  });

  it('raises nothing for a school that has a PAID seat order', async () => {
    expect(await make(25, { paid: true }).rule.evaluate(ctx)).toEqual([]);
  });

  it('raises nothing for a school that is not ACTIVE', async () => {
    expect(await make(25, { school: false }).rule.evaluate(ctx)).toEqual([]);
  });

  it('raises nothing when no active ADMIN exists', async () => {
    const { rule } = make(25, { members: [admin('a2', UserStatus.SUSPENDED)] });
    expect(await rule.evaluate(ctx)).toEqual([]);
  });

  it('scopes both queries to the tenant (tenant isolation)', async () => {
    const { rule, schools, memberships } = make(25);
    await rule.evaluate(ctx);
    expect(schools.findOne.mock.calls[0][0].where).toMatchObject({ id: 't1' });
    expect(memberships.find.mock.calls[0][0].where).toMatchObject({ tenant_id: 't1' });
  });

  it('renders the number in the en and bn titles', () => {
    const { rule } = make(25);
    expect(render(rule.messages, 'en', { days: 5 }).title).toContain('5');
    expect(render(rule.messages, 'bn', { days: 5 }).title).toContain('৫');
  });
});
