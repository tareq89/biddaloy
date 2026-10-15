import { describe, it, expect, vi } from 'vitest';
import { DigestScheduleProcessor } from './digest-schedule.processor';
import { DIGEST_RECONCILE_JOB, DIGEST_RUN_JOB } from './digest.constants';

const T = '00000000-0000-4000-8000-000001911001';

function make(syncAll = vi.fn().mockResolvedValue(undefined)) {
  const service = { syncAll, runNow: vi.fn().mockResolvedValue(undefined) };
  const queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
  return { service, queue, p: new DigestScheduleProcessor(queue as any, service as any) };
}

describe('DigestScheduleProcessor', () => {
  it('run job passes tenant and deferred flag to runNow', async () => {
    const { p, service } = make();
    await p.process({ name: DIGEST_RUN_JOB, data: { tenantId: T, deferred: true } } as any);
    expect(service.runNow).toHaveBeenCalledWith(T, true);
    await p.process({ name: DIGEST_RUN_JOB, data: { tenantId: T } } as any);
    expect(service.runNow).toHaveBeenLastCalledWith(T, false);
  });

  it('reconcile job calls syncAll', async () => {
    const { p, service } = make();
    await p.process({ name: DIGEST_RECONCILE_JOB, data: {} } as any);
    expect(service.syncAll).toHaveBeenCalledTimes(1);
  });

  it('boot survives syncAll throwing', async () => {
    const { p, queue } = make(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(p.onModuleInit()).resolves.toBeUndefined();
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
  });
});
