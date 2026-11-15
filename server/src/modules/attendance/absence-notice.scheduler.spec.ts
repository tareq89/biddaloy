import { IsNull } from 'typeorm';
import { isNoticeReady } from './absence-notice.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AbsenceNoticeScheduler,
  ABSENCE_NOTICE_SWEEP_JOB_ID,
  ABSENCE_NOTICE_SWEEP_INTERVAL_MS,
} from './absence-notice.scheduler';
import { AttendanceSessionState, AttendanceSource, UserRole } from '@biddaloy/shared';

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
  let moduleState: any;
  let scheduler: AbsenceNoticeScheduler;

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    sessionRepo = { find: vi.fn(async () => []) };
    userTenantRepo = {
      findOne: vi.fn(async () => ({ user_id: 'admin-1', role: UserRole.ADMIN })),
    };
    schoolsService = {
      findAllActive: vi.fn(async () => [{ id: TENANT, name: 'Green Valley School' }]),
      getResolvedSettings: vi.fn(async () => tenantSettings()),
    };
    schoolCalendarService = { isNonWorkingDay: vi.fn(async () => false) };
    absenceNoticeService = { sendAbsenceNotices: vi.fn(async () => ({ batch_id: 'b-1' })) };

    // [77.2.10] every module on unless a test says otherwise
    moduleState = { forTenant: vi.fn(async () => ({ platform: {}, school: {} })) };
    scheduler = new AbsenceNoticeScheduler(
      queue,
      sessionRepo,
      userTenantRepo,
      schoolsService,
      schoolCalendarService,
      absenceNoticeService,
      moduleState,
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

  it('sweeps FINALIZED sessions and the device sweep\'s SYSTEM DRAFTs, both with notified_at IS NULL (D30)', async () => {
    // Asserts the query shape; the wall-clock cut-off is covered at service level.
    await scheduler.process();

    const { where } = sessionRepo.find.mock.calls[0][0] as { where: Record<string, unknown>[] };
    expect(where).toHaveLength(2);
    expect(where[0]).toMatchObject({ tenant_id: TENANT, state: AttendanceSessionState.FINALIZED });
    expect(where[1]).toMatchObject({
      tenant_id: TENANT,
      state: AttendanceSessionState.DRAFT,
      source: AttendanceSource.SYSTEM,
      marked_by_user_id: IsNull(),
    });
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
    schoolsService.findAllActive.mockResolvedValue([
      { id: 'tenant-broken', name: 'Broken' },
      { id: TENANT, name: 'Green Valley School' },
    ]);
    schoolsService.getResolvedSettings = vi.fn(async (id: string) => {
      if (id === 'tenant-broken') throw new Error('boom');
      return tenantSettings();
    });
    sessionRepo.find = vi.fn(async () => [{ id: 'sess-1', section_id: 'sec-1' }]);

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('tenant-broken');
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith(TENANT);
    expect(absenceNoticeService.sendAbsenceNotices).toHaveBeenCalledTimes(1);
  });

  // [77.2.10] D9: attendance off for A -> A skipped (its settings are never even read), B still swept.
  it('skips a school with attendance off and still sweeps the next', async () => {
    schoolsService.findAllActive.mockResolvedValue([{ id: 'A' }, { id: 'B' }]);
    moduleState.forTenant.mockImplementation(async (id: string) => ({
      platform: {},
      school: id === 'A' ? { attendance: { on: false } } : {},
    }));
    await scheduler.process();
    expect(schoolsService.getResolvedSettings.mock.calls.map((c: any[]) => c[0])).toEqual(['B']);
  });

  // Fail closed: unreadable state skips that school and the sweep goes on.
  it('skips a school whose module state cannot be read and still sweeps the next', async () => {
    schoolsService.findAllActive.mockResolvedValue([{ id: 'A' }, { id: 'B' }]);
    moduleState.forTenant.mockImplementation(async (id: string) => {
      if (id === 'A') throw new Error('db down');
      return { platform: {}, school: {} };
    });
    await expect(scheduler.process()).resolves.toBeUndefined();
    expect(schoolsService.getResolvedSettings.mock.calls.map((c: any[]) => c[0])).toEqual(['B']);
  });
});

describe('isNoticeReady (D30)', () => {
  const S = AttendanceSessionState;
  const A = AttendanceSource;
  it.each([
    [S.FINALIZED, A.TEACHER, null, true],
    [S.DRAFT, A.SYSTEM, null, true],
    [S.DRAFT, A.SYSTEM, 'teacher-1', false], // teacher-saved draft that kept the SYSTEM source
    [S.DRAFT, A.TEACHER, null, false],
    [S.DRAFT, A.DEVICE, null, false],
  ])('%s + %s (marked by %s) -> %s', (state, source, marked_by_user_id, expected) => {
    expect(isNoticeReady({ state, source, marked_by_user_id })).toBe(expected);
  });
});
