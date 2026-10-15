import { describe, it, expect, vi } from 'vitest';
import {
  AttendanceSeriesScheduler,
  ATTENDANCE_SERIES_CRON,
  ATTENDANCE_SERIES_JOB_ID,
} from './attendance-series.scheduler';

function build(
  storeSeries = vi.fn(async () => []),
  storeCommitteeDaily = vi.fn(async () => undefined),
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
    // The committee card's per-day cache is refreshed by the same job.
    expect(storeCommitteeDaily).toHaveBeenCalledWith('t1', '2026-10-07');
    expect(storeCommitteeDaily).toHaveBeenCalledWith('t2', '2026-10-07');
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
});
