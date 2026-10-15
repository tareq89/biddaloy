import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtRiskProcessor } from './at-risk.processor';
import { AT_RISK_CRON, AT_RISK_SWEEP_JOB } from './at-risk.constants';
import { SCHOOL_TZ } from '../../../common/time';

describe('AtRiskProcessor', () => {
  let queue: { upsertJobScheduler: ReturnType<typeof vi.fn> };
  let schools: { findAllActive: ReturnType<typeof vi.fn> };
  let atRisk: { refresh: ReturnType<typeof vi.fn> };
  let processor: AtRiskProcessor;

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    schools = { findAllActive: vi.fn(async () => [{ id: 't1' }, { id: 't2' }, { id: 't3' }]) };
    atRisk = { refresh: vi.fn(async () => undefined) };
    processor = new AtRiskProcessor(queue as any, schools as any, atRisk as any);
  });

  it('registers the nightly cron at 00:30 in Asia/Dhaka', async () => {
    await processor.onModuleInit();
    expect(SCHOOL_TZ).toBe('Asia/Dhaka');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      AT_RISK_SWEEP_JOB,
      { pattern: AT_RISK_CRON, tz: 'Asia/Dhaka' },
      expect.anything(),
    );
    expect(AT_RISK_CRON).toBe('30 0 * * *');
  });

  it('sweep continues after one tenant throws', async () => {
    atRisk.refresh.mockImplementation(async (id: string) => {
      if (id === 't2') throw new Error('boom');
    });
    await processor.process({ name: 'sweep', data: undefined } as any);
    expect(atRisk.refresh.mock.calls.map((c) => c[0])).toEqual(['t1', 't2', 't3']);
  });

  it('tenant job computes only that tenant', async () => {
    await processor.process({ name: 'tenant', data: { tenantId: 't2' } } as any);
    expect(atRisk.refresh.mock.calls).toEqual([['t2']]);
    expect(schools.findAllActive).not.toHaveBeenCalled();
  });
});
