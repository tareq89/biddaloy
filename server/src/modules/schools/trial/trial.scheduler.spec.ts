import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrialScheduler } from './trial.scheduler';
import { TRIAL_JOB_ID } from './trial.constants';

describe('TrialScheduler', () => {
  afterEach(() => vi.unstubAllEnvs());

  const queue = () => ({
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(true),
  });

  it('schedules the daily job when not in the demo', async () => {
    const q = queue();
    await new TrialScheduler(q as any).onModuleInit();
    expect(q.upsertJobScheduler).toHaveBeenCalledOnce();
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
  });

  // [58.1.02] An expiring trial must never suspend a demo school.
  it('with DEMO_MODE does not schedule and clears any existing scheduler', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const q = queue();
    await new TrialScheduler(q as any).onModuleInit();
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
    expect(q.removeJobScheduler).toHaveBeenCalledWith(TRIAL_JOB_ID);
  });
});
