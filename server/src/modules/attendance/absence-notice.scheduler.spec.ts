import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AbsenceNoticeScheduler,
  ABSENCE_NOTICE_SWEEP_JOB_ID,
  ABSENCE_NOTICE_SWEEP_INTERVAL_MS,
} from './absence-notice.scheduler';
import { AttendanceSessionState, UserRole } from '@biddaloy/shared';

const TENANT = 'tenant-1';

function tenantSettings(overrides: Partial<any> = {}) {
  return {
    region: { timezone: 'Asia/Dhaka' },
    attendance: {
      // '00:00' so these tests never depend on wall-clock time-of-day —
      // the "before cut-off" behavior is covered by the dedicated test
      // below, which sets an unreachable cutoff explicitly instead.
      autoAbsentNotification: { enabled: true, cutoffTime: '00:00' },
    },
    ...overrides,
  };
}

describe('AbsenceNoticeScheduler', () => {
  let queue: any;
  let sessionRepo: any;
  let userTenantRepo: any;
  let schoolsService: any;
  let schoolCalendarService: any;
  let absenceNoticeService: any;
  let scheduler: AbsenceNoticeScheduler;

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    sessionRepo = { find: vi.fn(async () => []) };
    userTenantRepo = {
      findOne: vi.fn(async () => ({ user_id: 'admin-1', role: UserRole.ADMIN })),
    };
    schoolsService = {
      findAll: vi.fn(async () => [{ id: TENANT, name: 'Green Valley School' }]),
      getResolvedSettings: vi.fn(async () => tenantSettings()),
    };
    schoolCalendarService = { isNonWorkingDay: vi.fn(async () => false) };
    absenceNoticeService = { sendAbsenceNotices: vi.fn(async () => ({ batch_id: 'b-1' })) };

    scheduler = new AbsenceNoticeScheduler(
      queue,
      sessionRepo,
      userTenantRepo,
      schoolsService,
      schoolCalendarService,
      absenceNoticeService,
    );
  });

  it('registers a single repeatable job with a stable id on module init', async () => {
    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      ABSENCE_NOTICE_SWEEP_JOB_ID,
      { every: ABSENCE_NOTICE_SWEEP_INTERVAL_MS },
      expect.any(Object),
    );
  });

  it('does nothing for a tenant with auto-absent notification disabled', async () => {
    schoolsService.getResolvedSettings = vi.fn(async () =>
      tenantSettings({
        attendance: { autoAbsentNotification: { enabled: false, cutoffTime: '00:00' } },
      }),
    );

    await scheduler.process();

    expect(sessionRepo.find).not.toHaveBeenCalled();
    expect(absenceNoticeService.sendAbsenceNotices).not.toHaveBeenCalled();
  });

  it('does nothing before the tenant-configured cut-off time', async () => {
    // A literal '23:59' cutoff is "always in the future" for all but one
    // minute of the real day — at 23:59 Asia/Dhaka, `localTimeHHmm()`
    // equals the cutoff exactly, the scheduler's `<` comparison is no
    // longer true, and the sweep proceeds. Pinning the clock removes the
    // dependency on when the suite happens to run entirely.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z')); // 15:00 in Asia/Dhaka
    schoolsService.getResolvedSettings = vi.fn(async () =>
      tenantSettings({
        attendance: { autoAbsentNotification: { enabled: true, cutoffTime: '18:00' } },
      }),
    );

    await scheduler.process();
    vi.useRealTimers();

    expect(sessionRepo.find).not.toHaveBeenCalled();
    expect(absenceNoticeService.sendAbsenceNotices).not.toHaveBeenCalled();
  });

  it('does nothing on a non-working day even when enabled and past cut-off', async () => {
    schoolCalendarService.isNonWorkingDay = vi.fn(async () => true);

    await scheduler.process();

    expect(sessionRepo.find).not.toHaveBeenCalled();
  });

  it('only sweeps FINALIZED sessions with notified_at IS NULL, never DRAFT ones', async () => {
    // vitest can't fake Intl.DateTimeFormat's notion of "now" cheaply, so
    // this asserts the query shape the scheduler issues rather than the
    // wall-clock cut-off comparison, which the service-level integration
    // test exercises against a real clock.
    await scheduler.process();

    expect(sessionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT,
          state: AttendanceSessionState.FINALIZED,
        }),
      }),
    );
  });

  it('calls sendAbsenceNotices once per finalized, un-notified session found', async () => {
    sessionRepo.find = vi.fn(async () => [
      { id: 'sess-1', section_id: 'sec-1' },
      { id: 'sess-2', section_id: 'sec-2' },
    ]);

    await scheduler.process();

    expect(absenceNoticeService.sendAbsenceNotices).toHaveBeenCalledTimes(2);
    // Both sessions, not just "called twice plus one matcher" — that
    // would still pass if sec-1 were dispatched twice and sec-2 never was.
    expect(absenceNoticeService.sendAbsenceNotices).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        sectionId: 'sec-2',
        initiatedByUserId: 'admin-1',
      }),
    );
    expect(absenceNoticeService.sendAbsenceNotices).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        sectionId: 'sec-1',
        initiatedByUserId: 'admin-1',
      }),
    );
  });

  it('skips a tenant with finalized sessions but no ADMIN/EXECUTIVE user to attribute the batch to', async () => {
    sessionRepo.find = vi.fn(async () => [{ id: 'sess-1', section_id: 'sec-1' }]);
    userTenantRepo.findOne = vi.fn(async () => null);

    await scheduler.process();

    expect(absenceNoticeService.sendAbsenceNotices).not.toHaveBeenCalled();
  });

  it('does not let one tenant throwing block the rest of the sweep', async () => {
    schoolsService.findAll = vi.fn(async () => [
      { id: 'tenant-broken', name: 'Broken' },
      { id: TENANT, name: 'Green Valley School' },
    ]);
    schoolsService.getResolvedSettings = vi.fn(async (id: string) => {
      if (id === 'tenant-broken') throw new Error('boom');
      return tenantSettings();
    });
    sessionRepo.find = vi.fn(async () => [{ id: 'sess-1', section_id: 'sec-1' }]);

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(absenceNoticeService.sendAbsenceNotices).toHaveBeenCalledTimes(1);
  });
});
