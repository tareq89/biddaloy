import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { PlatformBackupFailingRule } from './platform-backup-failing.rule';
import { PlatformProviderFailuresRule } from './platform-provider-failures.rule';
import { PlatformTenantResolver } from './platform-tenant';
import { PlatformTrialsEndingRule } from './platform-trials-ending.rule';

const PID = 'platform';
const SUPER = { userId: 'sa1' };

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: PID,
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
  ...extra,
});

/** Recipient query returns the SUPER_ADMIN; every other query returns `rows`. */
function ds(rows: unknown[]) {
  const query = vi
    .fn()
    .mockImplementation(async (sql: string) =>
      sql.includes('FROM user_tenants') ? [SUPER] : rows,
    );
  return { query };
}
const resolver = (pid: string | undefined) => ({ resolve: async () => pid }) as never;

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('platform rules: shared contract', () => {
  const rules = [
    ['platform.backup_failing', new PlatformBackupFailingRule(ds([]) as never, resolver(PID))],
    ['platform.trials_ending', new PlatformTrialsEndingRule(ds([]) as never, resolver(PID))],
    [
      'platform.provider_failures',
      new PlatformProviderFailuresRule(ds([]) as never, resolver(PID)),
    ],
  ] as const;

  for (const [key, rule] of rules) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why)).toEqual(placeholders(bn.title + bn.why));
      expect(en.steps.length).toBeLessThanOrEqual(3);
    });
  }

  // Platform alerts must exist in the platform tenant only.
  for (const [key, make] of [
    ['backup_failing', (d: never, r: never) => new PlatformBackupFailingRule(d, r)],
    ['trials_ending', (d: never, r: never) => new PlatformTrialsEndingRule(d, r)],
    ['provider_failures', (d: never, r: never) => new PlatformProviderFailuresRule(d, r)],
  ] as const) {
    it(`${key}: other tenants and an unresolved platform tenant get nothing, with no query`, async () => {
      const d = ds([{ n: 99, schools: 3, name: 'X' }]);
      expect(await make(d as never, resolver(PID)).evaluate(ctx({ tenantId: 'school-a' }))).toEqual(
        [],
      );
      expect(await make(d as never, resolver(undefined)).evaluate(ctx())).toEqual([]);
      expect(d.query).not.toHaveBeenCalled();
    });
  }
});

describe('PlatformTenantResolver', () => {
  const make = (env: Record<string, string>, lookup = vi.fn()) => {
    const config = { get: (k: string) => env[k] };
    return {
      r: new PlatformTenantResolver(config as never, { findSchoolIdBySlug: lookup } as never),
      lookup,
    };
  };

  it('PLATFORM_TENANT_ID wins without a DB call', async () => {
    const { r, lookup } = make({ PLATFORM_TENANT_ID: 'p1' });
    expect(await r.resolve()).toBe('p1');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('production without the env fails closed', async () => {
    const { r, lookup } = make({ NODE_ENV: 'production' });
    expect(await r.resolve()).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('dev looks up default-school; caches a hit but not a miss', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('dev1');
    const { r } = make({}, lookup);
    expect(await r.resolve()).toBeUndefined(); // miss: not cached
    expect(await r.resolve()).toBe('dev1'); // hit
    expect(await r.resolve()).toBe('dev1'); // cached
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith('default-school');
  });
});

describe('PlatformBackupFailingRule', () => {
  const school = (name: string, schedule: string, lastStatus: string | null) => ({
    name,
    settings: { backup: { schedule } },
    created_at: new Date('2026-01-01T00:00:00Z'),
    last_status: lastStatus,
    last_success_at: new Date('2026-10-09T00:00:00Z'),
  });

  it('counts only unhealthy scheduled schools and lists at most three names', async () => {
    const rows = [
      school('A', 'DAILY', 'FAILED'),
      school('B', 'DAILY', 'FAILED'),
      school('C', 'DAILY', 'FAILED'),
      school('D', 'DAILY', 'FAILED'),
      school('Healthy', 'DAILY', 'DONE'),
      school('Off', 'OFF', 'FAILED'),
    ];
    const [f] = await new PlatformBackupFailingRule(ds(rows) as never, resolver(PID)).evaluate(
      ctx(),
    );
    expect(f.params).toEqual({ count: 4, schools: 'A, B, C …' });
    expect(f.dedupeKey).toBe('platform:backups');
    expect(f.recipients).toEqual([{ userId: 'sa1', role: UserRole.SUPER_ADMIN }]);
  });

  it('silent when everything is healthy', async () => {
    const rule = new PlatformBackupFailingRule(
      ds([school('A', 'DAILY', 'DONE')]) as never,
      resolver(PID),
    );
    expect(await rule.evaluate(ctx())).toEqual([]);
  });
});

describe('PlatformTrialsEndingRule', () => {
  it('local-midnight edge: window is [now, now + 7 days)', async () => {
    const d = ds([{ name: 'A' }]);
    await new PlatformTrialsEndingRule(d as never, resolver(PID)).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z') }),
    );
    expect(d.query.mock.calls[0][1]).toEqual([
      new Date('2026-10-09T18:00:00Z'),
      new Date('2026-10-16T18:00:00Z'),
    ]);
  });
});

describe('PlatformProviderFailuresRule', () => {
  const run = (n: number) =>
    new PlatformProviderFailuresRule(ds([{ n, schools: 2 }]) as never, resolver(PID)).evaluate(
      ctx(),
    );

  it('fires at the threshold, not below', async () => {
    expect(await run(19)).toEqual([]);
    const [f] = await run(20);
    expect(f.params).toEqual({ count: 20, schools: 2 });
  });
});
