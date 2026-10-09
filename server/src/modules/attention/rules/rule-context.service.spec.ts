import type { AttentionSettings } from '@biddaloy/shared';
import {
  RuleContextService,
  addDaysIso,
  endOfLocalDay,
  localDateTimeToUtc,
  localTimeHHmm,
} from './rule-context.service';
import { pickEscalation } from './rule.types';
import type { RuleContext } from './rule.types';

const TZ = 'Asia/Dhaka'; // UTC+6, no DST

const attention = {
  classStartingLeadMinutes: 10,
  dailyAt: '07:00',
  eveningAt: '17:00',
} as AttentionSettings;

function make(opts: { nonWorking?: boolean; rows?: unknown[] } = {}) {
  const schools = {
    getResolvedSettings: vi.fn().mockResolvedValue({ region: { timezone: TZ }, attention }),
  };
  const calendar = { isNonWorkingDay: vi.fn().mockResolvedValue(opts.nonWorking ?? false) };
  const dataSource = { query: vi.fn().mockResolvedValue(opts.rows ?? []) };
  const svc = new RuleContextService(schools as never, calendar as never, dataSource as never);
  return { svc, calendar, dataSource };
}

describe('time helpers', () => {
  it('localTimeHHmm', () => {
    expect(localTimeHHmm(new Date('2026-10-09T17:59:00Z'), TZ)).toBe('23:59');
    expect(localTimeHHmm(new Date('2026-10-09T18:00:00Z'), TZ)).toBe('00:00');
  });

  it('localDateTimeToUtc / endOfLocalDay / addDaysIso', () => {
    expect(localDateTimeToUtc('2026-10-10', '00:00', TZ).toISOString()).toBe(
      '2026-10-09T18:00:00.000Z',
    );
    expect(endOfLocalDay('2026-10-09', TZ).toISOString()).toBe('2026-10-09T18:00:00.000Z');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('RuleContextService.build', () => {
  it('local midnight rolls the date', async () => {
    const { svc } = make();
    expect((await svc.build('t1', new Date('2026-10-09T18:00:00Z'))).localDate).toBe('2026-10-10');
    expect((await svc.build('t1', new Date('2026-10-09T17:59:59Z'))).localDate).toBe('2026-10-09');
  });

  it('maps calendar and settings, scoped to the tenant', async () => {
    const { svc, calendar } = make({ nonWorking: true });
    const ctx = await svc.build('t1', new Date('2026-10-09T05:00:00Z'));
    expect(ctx.isWorkingDay).toBe(false);
    expect(ctx.settings).toBe(attention);
    expect(calendar.isNonWorkingDay).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });
});

describe('RuleContextService.isWithinSchoolHours', () => {
  const at = (localTime: string) =>
    ({ tenantId: 't1', localTime, settings: attention }) as RuleContext;

  it('uses period window minus lead, filtered by tenant_id', async () => {
    const { svc, dataSource } = make({ rows: [{ start: '08:00', end: '13:30' }] });
    expect(await svc.isWithinSchoolHours(at('07:49'))).toBe(false);
    expect(await svc.isWithinSchoolHours(at('07:50'))).toBe(true);
    expect(await svc.isWithinSchoolHours(at('13:30'))).toBe(true);
    expect(await svc.isWithinSchoolHours(at('13:31'))).toBe(false);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('tenant_id = $1'), [
      't1',
    ]);
  });

  it('falls back to dailyAt..eveningAt without slots', async () => {
    const { svc } = make({ rows: [{ start: null, end: null }] });
    expect(await svc.isWithinSchoolHours(at('06:59'))).toBe(false);
    expect(await svc.isWithinSchoolHours(at('07:00'))).toBe(true);
    expect(await svc.isWithinSchoolHours(at('17:01'))).toBe(false);
  });
});

describe('pickEscalation', () => {
  const steps = [
    { level: 1, after: { minutes: 30 }, severity: 'WARNING', addRoles: [] },
    { level: 2, after: { schoolDays: 2 }, severity: 'CRITICAL', addRoles: [] },
  ] as never;
  it('returns the highest reached step', () => {
    expect(pickEscalation(steps, { minutes: 10, schoolDays: 0 })).toBeNull();
    expect(pickEscalation(steps, { minutes: 40, schoolDays: 0 })?.level).toBe(1);
    expect(pickEscalation(steps, { minutes: 40, schoolDays: 2 })?.level).toBe(2);
  });
});
