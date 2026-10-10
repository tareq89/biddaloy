import { AlertCadence, alertRuleMeta } from '@biddaloy/shared';
import type { AttentionSettings } from '@biddaloy/shared';
import { ATTENTION_SWEEP_DONE, attentionEvents, attentionKeys } from '../attention.constants';
import type { AttentionRule, RuleContext } from '../rules/rule.types';
import { ATTENTION_RECHECK, emitRecheck } from './attention-events';
import { AttentionScheduler, isRuleEnabled } from './attention-scheduler';

const TZ = 'Asia/Dhaka';
const msg = { title: 't', why: 'w', steps: [] };
const settings = {
  dailyAt: '07:00',
  eveningAt: '17:00',
  rules: {},
} as unknown as AttentionSettings;

function fakeRule(
  key: Parameters<typeof alertRuleMeta>[0],
  evaluate = vi.fn().mockResolvedValue([]),
) {
  return { meta: alertRuleMeta(key), messages: { bn: msg, en: msg }, evaluate } as AttentionRule;
}

// Mirrors RuleContextService: local date/time come from the tz, not SCHOOL_TZ (D37).
function ctxAt(now: Date, over: Partial<RuleContext> = {}): RuleContext {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return {
    tenantId: 't1',
    now,
    tz: TZ,
    localDate: date,
    localTime: time,
    isWorkingDay: true,
    settings,
    ...over,
  };
}

function make(rules: AttentionRule[], opts: { ctx?: Partial<RuleContext>; within?: boolean } = {}) {
  const queue = {
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
  };
  const schools = {
    find: vi.fn().mockResolvedValue([{ id: 't1' }]),
    findOne: vi.fn().mockResolvedValue({ id: 't1' }),
  };
  const registry = {
    forCadence: vi.fn((c: AlertCadence) => rules.filter((r) => r.meta.cadence.includes(c))),
    get: vi.fn((k: string) => rules.find((r) => r.meta.key === k)),
  };
  const context = {
    build: vi.fn(async (_t: string, now: Date) => ctxAt(now, opts.ctx)),
    isWithinSchoolHours: vi.fn().mockResolvedValue(opts.within ?? true),
  };
  const writer = {
    apply: vi.fn().mockResolvedValue(undefined),
    expireDue: vi.fn().mockResolvedValue(undefined),
    wakeSnoozed: vi.fn().mockResolvedValue(undefined),
    withdrawRule: vi.fn().mockResolvedValue(undefined),
  };
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const redis = {
    set: vi.fn(async (k: string, ..._a: unknown[]) => {
      if (_a.includes('NX')) {
        if (seen.has(k)) return null;
        seen.add(k);
      }
      return 'OK';
    }),
    del: vi.fn(async (k: string) => seen.delete(k)),
    incr: vi.fn(async (k: string) => {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    }),
    hincrby: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  const dataSource = { query: vi.fn().mockResolvedValue([]) };
  const sched = new AttentionScheduler(
    queue as never,
    schools as never,
    registry as never,
    context as never,
    writer as never,
    redis as never,
    dataSource as never,
  );
  return { sched, queue, schools, registry, context, writer, redis, dataSource };
}

describe('AttentionScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    attentionEvents.removeAllListeners(ATTENTION_RECHECK);
  });
  afterEach(() => {
    vi.useRealTimers();
    attentionEvents.removeAllListeners(ATTENTION_RECHECK);
  });

  it('onModuleInit upserts the three schedulers', async () => {
    const { sched, queue } = make([]);
    await sched.onModuleInit();
    const calls = queue.upsertJobScheduler.mock.calls.map((c) => [c[0], c[1].every]);
    expect(calls).toEqual([
      ['attention-fast', 300000],
      ['attention-hourly', 3600000],
      ['attention-daily', 900000],
    ]);
  });

  it('isRuleEnabled honours disable only for rules that allow it (D34)', () => {
    const off = {
      rules: { 'system.backup_failed': { enabled: false }, 'class.starting': { enabled: false } },
    } as never;
    expect(isRuleEnabled(alertRuleMeta('system.backup_failed'), off)).toBe(true); // CRITICAL, cannot disable
    expect(isRuleEnabled(alertRuleMeta('class.starting'), off)).toBe(false);
    expect(isRuleEnabled(alertRuleMeta('class.starting'), settings)).toBe(true);
  });

  it('FAST on a non-working day expires/wakes but evaluates nothing', async () => {
    const rule = fakeRule('class.starting');
    const { sched, writer } = make([rule], { ctx: { isWorkingDay: false } });
    await sched.sweepTenant('t1', AlertCadence.FAST, new Date('2026-10-09T05:00:00Z'));
    expect(writer.expireDue).toHaveBeenCalled();
    expect(writer.wakeSnoozed).toHaveBeenCalled();
    expect(rule.evaluate).not.toHaveBeenCalled();
  });

  it('FAST outside school hours evaluates nothing', async () => {
    const rule = fakeRule('class.starting');
    const { sched } = make([rule], { within: false });
    await sched.sweepTenant('t1', AlertCadence.FAST, new Date('2026-10-09T05:00:00Z'));
    expect(rule.evaluate).not.toHaveBeenCalled();
  });

  it('DAILY runs once at dailyAt, not before, not twice', async () => {
    const rule = fakeRule('homework.due_today');
    const { sched } = make([rule]);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T00:59:00Z')); // 06:59
    expect(rule.evaluate).not.toHaveBeenCalled();
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:00:00Z')); // 07:00
    expect(rule.evaluate).toHaveBeenCalledTimes(1);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:15:00Z')); // 07:15, marker set
    expect(rule.evaluate).toHaveBeenCalledTimes(1);
  });

  it('DAILY rule that failed is retried on the next tick (marker released)', async () => {
    const evaluate = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    const rule = fakeRule('homework.due_today', evaluate);
    const { sched } = make([rule]);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:00:00Z'));
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:15:00Z'));
    expect(evaluate).toHaveBeenCalledTimes(2);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:30:00Z'));
    expect(evaluate).toHaveBeenCalledTimes(2); // success keeps the marker
  });

  it('a DAILY rule that keeps failing stops after 3 attempts that day', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('boom'));
    const rule = fakeRule('homework.due_today', evaluate);
    const { sched } = make([rule]);
    for (const at of ['01:00', '01:15', '01:30', '01:45', '02:00']) {
      await sched.sweepTenant('t1', AlertCadence.DAILY, new Date(`2026-10-09T${at}:00Z`));
    }
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('DAILY evening rule waits for eveningAt', async () => {
    const rule = fakeRule('homework.due_tomorrow');
    const { sched } = make([rule]);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:00:00Z')); // 07:00
    expect(rule.evaluate).not.toHaveBeenCalled();
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T11:00:00Z')); // 17:00
    expect(rule.evaluate).toHaveBeenCalledTimes(1);
  });

  it('DAILY marker uses the school-local date (rolls at Dhaka midnight)', async () => {
    const { sched, redis } = make([fakeRule('homework.due_today')]);
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T18:05:00Z'));
    const nx = redis.set.mock.calls.filter((c) => c.includes('NX')).map((c) => c[0]);
    expect(nx.length).toBeGreaterThan(0);
    for (const k of nx) expect(k).toMatch(/:2026-10-10$/);
  });

  it('DAILY with Redis down never runs the rule', async () => {
    const rule = fakeRule('homework.due_today');
    const { sched, redis } = make([rule]);
    redis.set.mockRejectedValue(new Error('down'));
    await sched.sweepTenant('t1', AlertCadence.DAILY, new Date('2026-10-09T01:00:00Z'));
    expect(rule.evaluate).not.toHaveBeenCalled();
  });

  it('a throwing rule is recorded; the next rule and tenant still run; heartbeat + event emitted', async () => {
    const bad = fakeRule('class.starting', vi.fn().mockRejectedValue(new Error('boom')));
    const good = fakeRule('attendance.not_taken');
    const { sched, schools, redis, writer } = make([bad, good]);
    schools.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const done = vi.fn();
    attentionEvents.once(ATTENTION_SWEEP_DONE, done);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const p = sched.runCadence(AlertCadence.FAST, new Date('2026-10-09T05:00:00Z'));
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(good.evaluate).toHaveBeenCalledTimes(2); // both tenants
    expect(writer.apply).toHaveBeenCalledTimes(2);
    expect(redis.hincrby).toHaveBeenCalledWith(
      attentionKeys.failingRule('class.starting'),
      'count',
      1,
    );
    expect(redis.set).toHaveBeenCalledWith(
      attentionKeys.heartbeat(AlertCadence.FAST),
      expect.any(String),
    );
    // rule-level failures are swallowed; tenant-level failures stay 0
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ tenants: 2, failures: 0 }));
    vi.restoreAllMocks();
  });

  it('counts a failure only when the tenant sweep itself throws', async () => {
    const { sched, schools, context } = make([]);
    schools.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    context.build.mockRejectedValueOnce(new Error('settings gone'));
    const done = vi.fn();
    attentionEvents.once(ATTENTION_SWEEP_DONE, done);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const p = sched.runCadence(AlertCadence.HOURLY, new Date());
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ tenants: 2, failures: 1 }));
    vi.restoreAllMocks();
  });

  it('a never-resolving rule is cut off after 10s and not applied', async () => {
    const hang = fakeRule(
      'class.starting',
      vi.fn(() => new Promise(() => undefined)),
    );
    const { sched, writer, redis } = make([hang]);
    const p = sched.sweepTenant('t1', AlertCadence.FAST, new Date('2026-10-09T05:00:00Z'));
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(writer.apply).not.toHaveBeenCalled();
    expect(redis.hincrby).toHaveBeenCalled();
  });

  it('a disabled WARNING rule is withdrawn, not evaluated', async () => {
    const rule = fakeRule('class.starting');
    const { sched, writer, context } = make([rule]);
    context.build.mockImplementation(async (_t: string, now: Date) =>
      ctxAt(now, {
        settings: { ...settings, rules: { 'class.starting': { enabled: false } } } as never,
      }),
    );
    await sched.sweepTenant('t1', AlertCadence.FAST, new Date('2026-10-09T05:00:00Z'));
    expect(writer.withdrawRule).toHaveBeenCalledWith('t1', 'class.starting');
    expect(rule.evaluate).not.toHaveBeenCalled();
  });

  it('emitRecheck enqueues a debounced recheck job; runRecheck passes actorUserId', async () => {
    const rule = fakeRule('setup.incomplete');
    const fastOnly = fakeRule('class.starting');
    const { sched, queue, context } = make([rule, fastOnly]);
    await sched.onModuleInit();
    const payload = { tenantId: 't1', ruleKey: 'setup.incomplete' as const, actorUserId: 'u1' };
    emitRecheck(attentionEvents, payload);
    expect(queue.add).toHaveBeenCalledWith(
      'recheck',
      payload,
      expect.objectContaining({
        deduplication: {
          id: 'recheck-t1-setup.incomplete',
          ttl: 5000,
          extend: true,
          replace: true,
        },
        delay: 5000,
        removeOnFail: true,
      }),
    );
    const now = new Date('2026-10-09T05:00:00Z');
    await sched.runRecheck(payload, now);
    expect(context.build).toHaveBeenCalledWith('t1', now, 'u1');
    expect(rule.evaluate).toHaveBeenCalled();
    await sched.runRecheck({ tenantId: 't1', ruleKey: 'class.starting' }, now);
    expect(fastOnly.evaluate).not.toHaveBeenCalled();
  });

  it('a failing recheck job never throws and onModuleDestroy removes the listener', async () => {
    const { sched, queue, context } = make([fakeRule('setup.incomplete')]);
    await sched.onModuleInit();
    context.build.mockRejectedValueOnce(new Error('boom'));
    await expect(
      sched.process({
        name: 'recheck',
        data: { tenantId: 't1', ruleKey: 'setup.incomplete' },
      } as never),
    ).resolves.toBeUndefined();
    sched.onModuleDestroy();
    emitRecheck(attentionEvents, { tenantId: 't1', ruleKey: 'setup.incomplete' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('only ACTIVE schools are swept / rechecked', async () => {
    const { sched, schools } = make([]);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const p = sched.runCadence(AlertCadence.HOURLY, new Date());
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(schools.find).toHaveBeenCalledWith({
      select: { id: true },
      where: { status: 'ACTIVE' },
    });
    vi.restoreAllMocks();
  });
});
