import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { OPS_QUEUES } from './ops-queues';
import { OpsQueuesService, RETRY_BATCH } from './ops-queues.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const KNOWN = OPS_QUEUES[0];

describe('OpsQueuesService', () => {
  const queue = { getJobCounts: vi.fn(), getFailed: vi.fn() };
  const mkJobs = (n: number) =>
    Array.from({ length: n }, () => ({ retry: vi.fn().mockResolvedValue(undefined) }));
  const moduleRef = { get: vi.fn() };
  const audit = { recordApproved: vi.fn() };
  let svc: OpsQueuesService;

  beforeEach(() => {
    vi.clearAllMocks();
    moduleRef.get.mockReturnValue(queue);
    queue.getJobCounts.mockResolvedValue({ waiting: 2, active: 1, failed: 3, delayed: 4 });
    queue.getFailed.mockResolvedValue(mkJobs(3));
    audit.recordApproved.mockResolvedValue(undefined);
    svc = new OpsQueuesService(moduleRef as never, audit as never);
  });

  it('list maps counts for every allow-listed queue and nothing else', async () => {
    const out = await svc.list();
    expect(out).toHaveLength(OPS_QUEUES.length);
    expect(out[0]).toEqual({
      name: KNOWN,
      available: true,
      waiting: 2,
      active: 1,
      failed: 3,
      delayed: 4,
    });
    expect(Object.keys(out[0]).sort()).toEqual(
      ['active', 'available', 'delayed', 'failed', 'name', 'waiting'].sort(),
    );
  });

  it('an unresolvable queue is available:false and does not fail the page', async () => {
    moduleRef.get.mockImplementation(() => {
      throw new Error('not found');
    });
    const out = await svc.list();
    expect(out.every((q) => q.available === false && q.waiting === undefined)).toBe(true);
  });

  it('a queue whose counts throw is available:false, the others still answer', async () => {
    queue.getJobCounts.mockRejectedValueOnce(new Error('boom with school data'));
    const out = await svc.list();
    expect(out[0]).toEqual({ name: KNOWN, available: false });
    expect(out[1].available).toBe(true);
  });

  it('unknown name is 404, never reaches getQueueToken or the queue, and is not echoed', async () => {
    const err = await svc.retryFailed('secret-probe-name', OWNER).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(JSON.stringify(err.getResponse())).not.toContain('secret-probe-name');
    expect(moduleRef.get).not.toHaveBeenCalled();
    expect(queue.getFailed).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('a known name that cannot be resolved is the same 404 and writes no audit', async () => {
    moduleRef.get.mockImplementation(() => {
      throw new Error('nope');
    });
    await expect(svc.retryFailed(KNOWN, OWNER)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('retries failed jobs, returns the count and audits with tenant_id null', async () => {
    await expect(svc.retryFailed(KNOWN, OWNER)).resolves.toEqual({ retried: 3 });
    expect(moduleRef.get).toHaveBeenCalledWith(getQueueToken(KNOWN), { strict: false });
    expect(queue.getFailed).toHaveBeenCalledWith(0, RETRY_BATCH - 1);
    expect(audit.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PLATFORM_QUEUE_RETRY,
        tenant_id: null,
        approved_by_user_id: OWNER,
        approval_scope: ApprovalScope.PLATFORM_OPS_ACTION,
        new_values: { queue: KNOWN, count: 3 },
      }),
    );
  });

  it('counts only jobs actually retried', async () => {
    const jobs = mkJobs(3);
    jobs[1].retry.mockRejectedValue(new Error('gone'));
    queue.getFailed.mockResolvedValue(jobs);
    await expect(svc.retryFailed(KNOWN, OWNER)).resolves.toEqual({ retried: 2 });
  });

  it('audit failure fails the request (never fail-open)', async () => {
    audit.recordApproved.mockRejectedValue(new Error('db down'));
    await expect(svc.retryFailed(KNOWN, OWNER)).rejects.toThrow('db down');
  });
});
