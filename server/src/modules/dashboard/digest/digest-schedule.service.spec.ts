import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DigestScheduleService } from './digest-schedule.service';
import { digestSchedulerIdFor, DIGEST_RUN_JOB } from './digest.constants';

const T = '00000000-0000-4000-8000-000001911001';
// 2026-10-08 07:30 Dhaka == 01:30 UTC, outside the 21:00-07:00 quiet hours.
const MORNING = new Date('2026-10-08T01:30:00Z');

describe('DigestScheduleService', () => {
  let queue: any,
    dataSource: any,
    redis: any,
    schools: any,
    calendar: any,
    push: any,
    attention: any;
  let service: DigestScheduleService;
  let settings: any;
  let rows: any[];
  const summary = (n: number) => ({
    critical: n,
    warning: 0,
    reminder: 0,
    top: n ? { title: 'Do it' } : null,
  });

  beforeEach(() => {
    queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      removeJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
    };
    rows = [];
    dataSource = { query: vi.fn(async () => rows) };
    const seen = new Set<string>();
    redis = { set: vi.fn(async (k: string) => (seen.has(k) ? null : (seen.add(k), 'OK'))) };
    settings = {
      dashboard: { digestTime: '07:30' },
      region: { timezone: 'Asia/Dhaka', locale: 'en' },
      attention: { quietHours: { start: '21:00', end: '07:00' } },
    };
    schools = {
      findById: vi.fn().mockResolvedValue({ id: T, name: 'Sunrise', status: 'ACTIVE' }),
      findAll: vi.fn().mockResolvedValue([{ id: T }]),
      getResolvedSettings: vi.fn(async () => settings),
    };
    calendar = { isNonWorkingDay: vi.fn().mockResolvedValue(false) };
    push = { sendToUser: vi.fn().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 }) };
    attention = { summary: vi.fn(async () => summary(2)) };
    service = new DigestScheduleService(
      queue,
      dataSource,
      redis,
      schools,
      calendar,
      push,
      attention,
    );
  });

  describe('sync', () => {
    it('upserts at digestTime in the school timezone', async () => {
      settings.dashboard.digestTime = '07:15';
      await service.sync(T);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        digestSchedulerIdFor(T),
        { pattern: '15 07 * * *', tz: 'Asia/Dhaka' },
        expect.objectContaining({ name: DIGEST_RUN_JOB, data: { tenantId: T } }),
      );
    });

    it('a changed digestTime re-upserts the same scheduler id with the new pattern', async () => {
      await service.sync(T);
      settings.dashboard.digestTime = '09:05';
      settings.region.timezone = 'Asia/Kolkata';
      await service.sync(T);
      const [id, repeat] = queue.upsertJobScheduler.mock.calls[1];
      expect(id).toBe(digestSchedulerIdFor(T));
      expect(repeat).toEqual({ pattern: '05 09 * * *', tz: 'Asia/Kolkata' });
    });

    it('default 07:30 gives 30 07', async () => {
      await service.sync(T);
      expect(queue.upsertJobScheduler.mock.calls[0][1].pattern).toBe('30 07 * * *');
    });

    it('suspended school: scheduler removed, none upserted', async () => {
      schools.findById.mockResolvedValue({ id: T, status: 'SUSPENDED' });
      await service.sync(T);
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(digestSchedulerIdFor(T));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('syncAll continues after one school throws', async () => {
      schools.findAll.mockResolvedValue([{ id: 'bad' }, { id: T }]);
      schools.findById.mockImplementation(async (id: string) => {
        if (id === 'bad') throw new Error('boom');
        return { id, status: 'ACTIVE' };
      });
      await service.syncAll();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    });
  });

  describe('runNow', () => {
    it('sends to each recipient with count > 0, url /dashboard', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).toHaveBeenCalledWith(
        'u1',
        T,
        expect.objectContaining({ type: 'dashboard-digest', url: '/dashboard', title: 'Sunrise' }),
      );
      expect(attention.summary).toHaveBeenCalledWith(T, 'u1', 'ADMIN', { locale: 'en' });
    });

    it('opted-out user is skipped without computing anything', async () => {
      rows = [{ id: 'u1', role: 'TEACHER', preferences: { digest: { enabled: false } } }];
      await service.runNow(T, false, MORNING);
      expect(attention.summary).not.toHaveBeenCalled();
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('count 0 sends no push', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      attention.summary.mockResolvedValue(summary(0));
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('non-working day sends nothing', async () => {
      calendar.isNonWorkingDay.mockResolvedValue(true);
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('suspended school sends nothing and drops its scheduler', async () => {
      schools.findById.mockResolvedValue({ id: T, status: 'SUSPENDED' });
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).not.toHaveBeenCalled();
      expect(queue.removeJobScheduler).toHaveBeenCalled();
    });

    it('checks the school-local date: 18:30Z on the 7th is the 8th in Dhaka', async () => {
      settings.attention.quietHours = { start: '00:00', end: '00:00' }; // off, isolate the date
      await service.runNow(T, false, new Date('2026-10-07T18:30:00Z'));
      expect(calendar.isNonWorkingDay).toHaveBeenCalledWith({ tenantId: T, date: '2026-10-08' });
    });

    it('inside quiet hours the run is deferred to their end, not sent', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      // 22:00 Dhaka == 16:00Z; quiet hours end at 07:00 Dhaka, 9h later.
      await service.runNow(T, false, new Date('2026-10-08T16:00:00Z'));
      expect(push.sendToUser).not.toHaveBeenCalled();
      const [name, data, opts] = queue.add.mock.calls[0];
      expect(name).toBe(DIGEST_RUN_JOB);
      expect(data).toEqual({ tenantId: T, deferred: true });
      expect(opts.delay).toBe(9 * 3600_000);
    });

    it('a deferred run sends even though it fires at the end of quiet hours', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, true, new Date('2026-10-08T16:00:00Z'));
      expect(push.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('one failing user does not stop the others', async () => {
      rows = [
        { id: 'u1', role: 'ADMIN', preferences: null },
        { id: 'u2', role: 'TEACHER', preferences: null },
      ];
      attention.summary.mockImplementationOnce(async () => {
        throw new Error('boom');
      });
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      expect(push.sendToUser.mock.calls[0][0]).toBe('u2');
    });

    it('a second run the same day sends nothing (idempotent)', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, false, MORNING);
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).toHaveBeenCalledTimes(1);
    });

    it('the next day sends again', async () => {
      rows = [{ id: 'u1', role: 'ADMIN', preferences: null }];
      await service.runNow(T, false, MORNING);
      await service.runNow(T, false, new Date(MORNING.getTime() + 86_400_000));
      expect(push.sendToUser).toHaveBeenCalledTimes(2);
    });

    it('a person with two digest roles gets one push, for the first role', async () => {
      rows = [
        { id: 'u1', role: 'TEACHER', preferences: null },
        { id: 'u1', role: 'ADMIN', preferences: null },
      ];
      await service.runNow(T, false, MORNING);
      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      expect(attention.summary).toHaveBeenCalledWith(T, 'u1', 'ADMIN', expect.anything());
    });

    it('recipient query is scoped to the tenant', async () => {
      await service.runNow(T, false, MORNING);
      expect(dataSource.query.mock.calls[0][1][0]).toBe(T);
      expect(dataSource.query.mock.calls[0][0]).toContain('ut.tenant_id = $1');
    });
  });
});
