import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { StudyPlanFlagsScheduler, addDays, isoYearWeek } from './study-plan-flags.scheduler';
import {
  teacherReminderBody,
  escalationBody,
  guardianBody,
  committeeLine,
  toBn,
} from './study-plan-flags.messages';

const TENANT = 't1';
// Dhaka (UTC+6). 2026-10-15 is a Thursday; Friday is the weekly off day.
const SETTINGS = {
  statusDeadline: '18:00',
  reminderTime: '08:00',
  escalateAfterSchoolDays: 2,
  weeklyDigestTime: '17:00',
  guardianDigestSms: false,
};

function build(opts: { holidays?: string[]; weeklyOff?: number[]; unreported?: string[] } = {}) {
  const holidays = new Set(opts.holidays ?? []);
  const weeklyOff = opts.weeklyOff ?? [5];
  const redis = new Map<string, string>();
  const pushed: { userId: string; body: string }[] = [];
  const isOff = (iso: string) => weeklyOff.includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
  const working = (iso: string) => !isOff(iso) && !holidays.has(iso);

  const calendar = {
    isNonWorkingDay: vi.fn(async ({ date }: { date: string }) => !working(date)),
    getWorkingDays: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      const dates: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) if (working(d)) dates.push(d);
      return { dates, count: dates.length };
    }),
  };
  const push = {
    sendToUser: vi.fn(async (userId: string, _t: string, p: { body: string }) => {
      if (userId === 'u-bad') throw new Error('boom');
      pushed.push({ userId, body: p.body });
    }),
  };
  const planRepo = {
    find: vi.fn(async () => [
      { id: 'p1', section_id: 's1', subject_id: 'm', academic_year_id: 'y' },
    ]),
    manager: {
      query: vi.fn(async (_sql: string, params: unknown[]) =>
        (params[1] as string[]).map((id) => ({ id, user_id: `u-${id}` })),
      ),
    },
  };
  const schedule = {
    scheduleFor: vi.fn(async () => ({
      periods: (opts.unreported ?? []).map((date) => ({ status: 'UNREPORTED', date })),
    })),
  };
  const plans = { ownerTeacherIds: vi.fn(async () => ['T1']) };
  const memberships = {
    find: vi.fn(async () => [
      { user: { id: 'admin', status: UserStatus.ACTIVE } },
      { user: { id: 'gone', status: UserStatus.INACTIVE } },
    ]),
  };
  const scheduler = new StudyPlanFlagsScheduler(
    {} as never,
    planRepo as never,
    {} as never,
    memberships as never,
    { findOne: vi.fn(async () => ({ id: 'y' })) } as never,
    {
      set: vi.fn(async (k: string) => {
        if (redis.has(k)) return null;
        redis.set(k, '1');
        return 'OK';
      }),
    } as never,
    {
      getResolvedSettings: vi.fn(async () => ({
        region: { timezone: 'Asia/Dhaka' },
        attendance: { weeklyOffDays: weeklyOff },
      })),
    } as never,
    { studyPlansSettings: vi.fn(async () => SETTINGS) } as never,
    calendar as never,
    schedule as never,
    plans as never,
    push as never,
    {} as never,
    {} as never,
  );
  return { scheduler, redis, pushed, push, calendar, plans };
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe('StudyPlanFlagsScheduler [66.2.05]', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  describe('reminder: fixed local hour + marker', () => {
    it('sends nothing before 08:00 Dhaka, once after, and nothing on a second sweep', async () => {
      const { scheduler, pushed, redis } = build({ unreported: ['2026-10-14'] });
      at('2026-10-15T01:59:00Z'); // 07:59 Dhaka
      await scheduler.sweepTenant(TENANT);
      expect(pushed).toHaveLength(0);
      expect(redis.size).toBe(0); // no marker taken before the hour

      at('2026-10-15T02:01:00Z'); // 08:01 Dhaka
      await scheduler.sweepTenant(TENANT);
      expect(pushed).toEqual([{ userId: 'u-T1', body: teacherReminderBody(1) }]);

      at('2026-10-15T02:16:00Z');
      await scheduler.sweepTenant(TENANT);
      expect(pushed).toHaveLength(1); // marker holds
    });

    it('uses the Dhaka date for the marker key at Dhaka midnight, and sends nothing', async () => {
      const { scheduler, pushed, redis } = build({ unreported: ['2026-10-14'] });
      at('2026-10-14T18:01:00Z'); // 00:01 on the 15th in Dhaka, still the 14th in UTC
      await scheduler.sweepTenant(TENANT);
      expect(pushed).toHaveLength(0); // 00:01 < 08:00

      at('2026-10-15T02:01:00Z');
      await scheduler.sweepTenant(TENANT);
      expect([...redis.keys()]).toContain(`tenant:${TENANT}:study-plans:reminder:2026-10-15`);
    });

    it('takes the marker before pushing, and one failing teacher does not stop the others', async () => {
      const { scheduler, pushed, redis, push, plans } = build({ unreported: ['2026-10-14'] });
      push.sendToUser.mockImplementation(
        async (userId: string, _t: string, p: { body: string }) => {
          // The marker must already exist when the first push goes out.
          expect(redis.has(`tenant:${TENANT}:study-plans:reminder:2026-10-15`)).toBe(true);
          if (userId === 'u-T1') throw new Error('boom');
          pushed.push({ userId, body: p.body });
        },
      );
      plans.ownerTeacherIds.mockResolvedValue(['T1', 'T2']);
      at('2026-10-15T02:01:00Z');
      await scheduler.sweepTenant(TENANT);
      expect(push.sendToUser).toHaveBeenCalledTimes(2);
      expect(pushed).toEqual([{ userId: 'u-T2', body: teacherReminderBody(1) }]);
    });

    it('sends nothing on a non-working day', async () => {
      const { scheduler, pushed, redis } = build({
        unreported: ['2026-10-14'],
        holidays: ['2026-10-15'],
      });
      at('2026-10-15T03:00:00Z');
      await scheduler.sweepTenant(TENANT);
      expect(pushed).toHaveLength(0);
      expect(redis.size).toBe(0);
    });
  });

  describe('escalation threshold', () => {
    it('does not escalate a period unreported for 1 working day, escalates at 2', async () => {
      const a = build();
      await a.scheduler.runEscalation(
        TENANT,
        '2026-10-15',
        [{ date: '2026-10-14', teacherId: 'T1' }],
        SETTINGS,
      );
      expect(a.pushed).toHaveLength(0);

      const b = build();
      await b.scheduler.runEscalation(
        TENANT,
        '2026-10-15',
        [{ date: '2026-10-13', teacherId: 'T1' }],
        SETTINGS,
      );
      // Inactive members are skipped.
      expect(b.pushed).toEqual([{ userId: 'admin', body: escalationBody(1, 2) }]);
    });

    it('does not count a holiday between the two days', async () => {
      // 14th is a holiday: working days before the 15th are ..., 12th, 13th. Cutoff (2nd back) = 12th.
      const c = build({ holidays: ['2026-10-14'] });
      await c.scheduler.runEscalation(
        TENANT,
        '2026-10-15',
        [{ date: '2026-10-13', teacherId: 'T1' }],
        SETTINGS,
      );
      expect(c.pushed).toHaveLength(0); // the 13th is only 1 working day back
      await c.scheduler.runEscalation(
        TENANT,
        '2026-10-15',
        [{ date: '2026-10-12', teacherId: 'T1' }],
        SETTINGS,
      );
      expect(c.pushed).toHaveLength(1);
    });
  });

  describe('digest: last working day of the week', () => {
    it('is Thursday when Friday is off, Wednesday when Thursday is a holiday', async () => {
      const normal = build();
      expect(await normal.scheduler.isLastWorkingDayOfWeek(TENANT, '2026-10-15')).toBe(true); // Thu
      expect(await normal.scheduler.isLastWorkingDayOfWeek(TENANT, '2026-10-14')).toBe(false); // Wed
      const hol = build({ holidays: ['2026-10-15'] });
      expect(await hol.scheduler.isLastWorkingDayOfWeek(TENANT, '2026-10-14')).toBe(true);
    });

    it('is never true when the school has no weekly-off day', async () => {
      const { scheduler } = build({ weeklyOff: [] });
      expect(await scheduler.isLastWorkingDayOfWeek(TENANT, '2026-10-15')).toBe(false);
    });

    it('fires the digest once per ISO week, at or after 17:00', async () => {
      const { scheduler } = build();
      const digest = vi.spyOn(scheduler, 'runDigest').mockResolvedValue();
      at('2026-10-15T10:59:00Z'); // 16:59 Dhaka, Thursday
      await scheduler.sweepTenant(TENANT);
      expect(digest).not.toHaveBeenCalled();
      at('2026-10-15T11:01:00Z'); // 17:01
      await scheduler.sweepTenant(TENANT);
      expect(digest).toHaveBeenCalledTimes(1);
      at('2026-10-15T11:16:00Z');
      await scheduler.sweepTenant(TENANT);
      expect(digest).toHaveBeenCalledTimes(1); // week marker
    });

    it('does not send on a Wednesday, but sends Wednesday when Thursday is a holiday', async () => {
      const a = build();
      const da = vi.spyOn(a.scheduler, 'runDigest').mockResolvedValue();
      at('2026-10-14T11:01:00Z');
      await a.scheduler.sweepTenant(TENANT);
      expect(da).not.toHaveBeenCalled();

      const b = build({ holidays: ['2026-10-15'] });
      const db = vi.spyOn(b.scheduler, 'runDigest').mockResolvedValue();
      at('2026-10-14T11:01:00Z');
      await b.scheduler.sweepTenant(TENANT);
      expect(db).toHaveBeenCalledTimes(1);
    });

    it('never sends when no weekly-off day is configured', async () => {
      const { scheduler } = build({ weeklyOff: [] });
      const digest = vi.spyOn(scheduler, 'runDigest').mockResolvedValue();
      at('2026-10-15T11:01:00Z');
      await scheduler.sweepTenant(TENANT);
      expect(digest).not.toHaveBeenCalled();
    });
  });

  describe('week key and messages', () => {
    it('computes the ISO year-week', () => {
      expect(isoYearWeek('2026-10-15')).toBe('2026-W42');
      expect(isoYearWeek('2026-01-01')).toBe('2026-W01');
    });

    it('uses Bangla digits and "পাঠ পরিকল্পনা", never "প্ল্যান"', () => {
      const all = [
        teacherReminderBody(2),
        escalationBody(3, 2),
        guardianBody('রহিম', '7-খ', [{ subject: 'গণিত', periods: 4 }]),
        committeeLine('7', 24, 5),
      ].join('\n');
      expect(teacherReminderBody(2)).toBe(
        'গতকালের ২টি পিরিয়ডের পাঠ পরিকল্পনার অবস্থা জানানো হয়নি',
      );
      expect(guardianBody('রহিম', '7-খ', [{ subject: 'গণিত', periods: 4 }])).toBe(
        'রহিম (৭-খ): গণিত ৪ পিরিয়ড পিছিয়ে',
      );
      expect(all).not.toMatch(/[0-9]/);
      expect(all).not.toContain('প্ল্যান');
      expect(toBn(2026)).toBe('২০২৬');
      expect(UserRole.COMMITTEE).toBeDefined();
    });
  });
});
