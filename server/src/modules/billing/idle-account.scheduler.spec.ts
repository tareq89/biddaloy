import { describe, it, expect, vi, afterEach } from 'vitest';
const legacy = vi.hoisted(() => ({
  removeJobScheduler: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
  names: [] as string[],
}));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      legacy.names.push(name);
    }
    removeJobScheduler = legacy.removeJobScheduler;
    close = legacy.close;
  },
}));

import { IdleAccountScheduler, IDLE_CRON, IDLE_JOB_ID } from './idle-account.scheduler';

describe('IdleAccountScheduler', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  const build = () => {
    const queue = { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(), opts: {} };
    const idle = { runDaily: vi.fn().mockResolvedValue({}) };
    return { scheduler: new IdleAccountScheduler(queue as never, idle as never), queue, idle };
  };

  it('registers the daily 01:00 Asia/Dhaka job', async () => {
    delete process.env.DEMO_MODE;
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(IDLE_CRON).toBe('0 1 * * *');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      IDLE_JOB_ID,
      { pattern: IDLE_CRON, tz: 'Asia/Dhaka' },
      expect.anything(),
    );
  });

  it('does not schedule in demo mode and removes any existing job', async () => {
    process.env.DEMO_MODE = 'true';
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(IDLE_JOB_ID);
  });

  it('removes the retired trial-lifecycle scheduler on boot (#2764)', async () => {
    delete process.env.DEMO_MODE;
    legacy.names.length = 0;
    const { scheduler } = build();
    await scheduler.onModuleInit();
    expect(legacy.names).toEqual(['trial-lifecycle']);
    expect(legacy.removeJobScheduler).toHaveBeenCalledWith('trial-lifecycle');
    expect(legacy.close).toHaveBeenCalled();
  });

  it('boots even when Redis refuses the legacy removal', async () => {
    delete process.env.DEMO_MODE;
    legacy.removeJobScheduler.mockRejectedValueOnce(new Error('down'));
    const { scheduler, queue } = build();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
  });

  it('process() runs the daily idle check', async () => {
    const { scheduler, idle } = build();
    await scheduler.process();
    expect(idle.runDaily).toHaveBeenCalledTimes(1);
  });
});
