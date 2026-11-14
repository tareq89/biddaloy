import { describe, it, expect, vi, afterEach } from 'vitest';
import { SmsExpiryScheduler, SMS_EXPIRY_CRON, SMS_EXPIRY_JOB_ID } from './sms-expiry.scheduler';

describe('SmsExpiryScheduler', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  const build = () => {
    const queue = { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() };
    const expiry = { run: vi.fn().mockResolvedValue({}) };
    return { queue, expiry, scheduler: new SmsExpiryScheduler(queue as never, expiry as never) };
  };

  it('registers the daily 00:20 Asia/Dhaka job', async () => {
    delete process.env.DEMO_MODE;
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(SMS_EXPIRY_CRON).toBe('20 0 * * *');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SMS_EXPIRY_JOB_ID,
      { pattern: SMS_EXPIRY_CRON, tz: 'Asia/Dhaka' },
      expect.anything(),
    );
  });

  it('does not schedule in demo mode and removes any existing job', async () => {
    process.env.DEMO_MODE = 'true';
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(SMS_EXPIRY_JOB_ID);
  });

  it('process runs the service, and a failure is rethrown for BullMQ', async () => {
    const { scheduler, expiry } = build();
    await scheduler.process();
    expect(expiry.run).toHaveBeenCalledTimes(1);
    expiry.run.mockRejectedValueOnce(new Error('boom'));
    await expect(scheduler.process()).rejects.toThrow('boom');
  });
});
