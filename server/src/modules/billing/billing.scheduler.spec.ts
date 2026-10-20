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
    const scheduler = new BillingScheduler(queue as never, schools as never, entitlement as never);
    return { scheduler, queue, entitlement };
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
