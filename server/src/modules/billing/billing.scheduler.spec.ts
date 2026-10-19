import { describe, it, expect, vi, afterEach } from 'vitest';
import { BillingScheduler, BILLING_CRON, BILLING_JOB_ID } from './billing.scheduler';

describe('BillingScheduler', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  const build = () => {
    const queue = { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() };
    const schools = { findAllActive: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) };
    const entitlement = { recomputeAndNotify: vi.fn() };
    const seatNotices = { runDaily: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }) };
    const scheduler = new BillingScheduler(
      queue as never,
      schools as never,
      entitlement as never,
      seatNotices as never,
    );
    return { scheduler, queue, entitlement, seatNotices };
  };

  it('registers the daily 00:10 Asia/Dhaka job', async () => {
    delete process.env.DEMO_MODE;
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_JOB_ID,
      { pattern: BILLING_CRON, tz: 'Asia/Dhaka' },
      expect.anything(),
    );
  });

  it('does not schedule in demo mode and removes any existing job', async () => {
    process.env.DEMO_MODE = 'true';
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(BILLING_JOB_ID);
  });

  it('one failing school does not stop the rest', async () => {
    const { scheduler, entitlement } = build();
    entitlement.recomputeAndNotify.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    await scheduler.process();
    expect(entitlement.recomputeAndNotify).toHaveBeenCalledTimes(2);
  });
});

describe('BillingScheduler notices', () => {
  const make = (runDaily: () => Promise<unknown>) => {
    const entitlement = { recomputeAndNotify: vi.fn().mockResolvedValue(false) };
    const schools = { findAllActive: vi.fn().mockResolvedValue([{ id: 'a' }]) };
    const scheduler = new BillingScheduler(
      {} as never,
      schools as never,
      entitlement as never,
      { runDaily } as never,
    );
    return { scheduler, entitlement };
  };

  it('sends the seat notices after the recompute', async () => {
    const order: string[] = [];
    const { scheduler, entitlement } = make(async () => order.push('notices'));
    entitlement.recomputeAndNotify.mockImplementation(async () => {
      order.push('recompute');
      return false;
    });
    await scheduler.process();
    expect(order).toEqual(['recompute', 'notices']);
  });

  it('a failing notices run does not fail the job', async () => {
    const { scheduler } = make(async () => {
      throw new Error('boom');
    });
    await expect(scheduler.process()).resolves.toBeUndefined();
  });
});
