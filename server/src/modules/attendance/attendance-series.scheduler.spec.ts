import { describe, it, expect, vi } from 'vitest';
import {
  AttendanceSeriesScheduler,
  ATTENDANCE_SERIES_CRON,
  ATTENDANCE_SERIES_JOB_ID,
} from './attendance-series.scheduler';

function build(
  storeSeries = vi.fn(async () => []),
  storeCommitteeDaily = vi.fn(async () => undefined),
  forTenant: (id: string) => Promise<unknown> = async () => ({ platform: {}, school: {} }),
) {
  const queue = { upsertJobScheduler: vi.fn(async () => undefined) };
  const schools = {
    findAllActive: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]),
    todayFor: vi.fn(async () => '2026-10-08'),
  };
  const scheduler = new AttendanceSeriesScheduler(
    queue as any,
    schools as any,
    {
      storeSeries,
      storeCommitteeDaily,
    } as any,
    { forTenant } as any,
  );
  return { scheduler, queue, storeSeries, storeCommitteeDaily };
}

describe('AttendanceSeriesScheduler', () => {
  it('registers the cron in Asia/Dhaka', async () => {
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      ATTENDANCE_SERIES_JOB_ID,
      { pattern: ATTENDANCE_SERIES_CRON, tz: 'Asia/Dhaka' },
      expect.anything(),
    );
    expect(ATTENDANCE_SERIES_CRON).toBe('15 0 * * *');
  });

  it("stores each tenant's series ending yesterday", async () => {
    const { scheduler, storeSeries, storeCommitteeDaily } = build();
    await scheduler.process();
    expect(storeSeries).toHaveBeenCalledWith('t1', '2026-10-07');
    expect(storeSeries).toHaveBeenCalledWith('t2', '2026-10-07');
    // The committee card's per-day cache (today-8; last 7 days are live) is refreshed by the same job.
    expect(storeCommitteeDaily).toHaveBeenCalledWith('t1', '2026-09-30');
    expect(storeCommitteeDaily).toHaveBeenCalledWith('t2', '2026-09-30');
  });

  it('one tenant throwing does not stop the next', async () => {
    const storeSeries = vi.fn(async (tenantId: string) => {
      if (tenantId === 't1') throw new Error('boom');
      return [];
    });
    const { scheduler } = build(storeSeries as any);
    await expect(scheduler.process()).resolves.toBeUndefined();
    expect(storeSeries).toHaveBeenCalledTimes(2);
  });

  // [77.2.10] D9: Attendance off for t1 -> t1 skipped, t2 still processed.
  it('skips a school with attendance off and still processes the next', async () => {
    const { scheduler, storeSeries, storeCommitteeDaily } = build(
      undefined,
      undefined,
      async (id) => ({ platform: {}, school: id === 't1' ? { attendance: { on: false } } : {} }),
    );
    await scheduler.process();
    expect(storeSeries).toHaveBeenCalledTimes(1);
    expect(storeSeries).toHaveBeenCalledWith('t2', '2026-10-07');
    expect(storeCommitteeDaily).not.toHaveBeenCalledWith('t1', expect.anything());
  });

  // Fail closed: unreadable state is never treated as on.
  it('skips a school whose module state cannot be read and still processes the next', async () => {
    const { scheduler, storeSeries } = build(undefined, undefined, async (id) => {
      if (id === 't1') throw new Error('db down');
      return { platform: {}, school: {} };
    });
    await expect(scheduler.process()).resolves.toBeUndefined();
    expect(storeSeries).toHaveBeenCalledTimes(1);
    expect(storeSeries).toHaveBeenCalledWith('t2', '2026-10-07');
  });
});
