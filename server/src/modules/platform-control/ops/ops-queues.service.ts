import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import type { OpsQueueDto, OpsRetryResponseDto } from './dto/ops-queues.dto';
import { OPS_QUEUES } from './ops-queues';

/** Most jobs one retry moves; the owner presses again for the rest. */
export const RETRY_BATCH = 1000;

@Injectable()
export class OpsQueuesService {
  private readonly logger = new Logger(OpsQueuesService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuditService,
  ) {}

  /** `strict: false` finds the queue wherever a module registered it. Unresolvable gives null. */
  private find(name: string): Queue | null {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      return null;
    }
  }

  async list(): Promise<OpsQueueDto[]> {
    return Promise.all(
      OPS_QUEUES.map(async (name): Promise<OpsQueueDto> => {
        const queue = this.find(name);
        if (!queue) return { name, available: false };
        try {
          const c = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
          return {
            name,
            available: true,
            waiting: c.waiting ?? 0,
            active: c.active ?? 0,
            failed: c.failed ?? 0,
            delayed: c.delayed ?? 0,
          };
        } catch (err) {
          // One broken queue must not blank the page. Log the error class only, never its text.
          this.logger.warn(`Queue counts failed for ${name}: ${(err as Error).name}`);
          return { name, available: false };
        }
      }),
    );
  }

  /**
   * Unknown name is 404 before any queue lookup, and the name is not echoed (Rule 23).
   * Audit uses `recordApproved`, which never fails open: the row proves who signed off.
   * Redis down is a 503 from the route's `@FailClosedWithoutRedis()`, before this runs.
   */
  async retryFailed(name: string, ownerId: string): Promise<OpsRetryResponseDto> {
    const queue = OPS_QUEUES.includes(name) ? this.find(name) : null;
    if (!queue) throw new NotFoundException('Queue not found.');
    const before = (await queue.getJobCounts('failed')).failed ?? 0;
    await queue.retryJobs({ state: 'failed', count: RETRY_BATCH });
    const retried = Math.min(before, RETRY_BATCH);
    await this.audit.recordApproved({
      action: AuditAction.PLATFORM_QUEUE_RETRY,
      entity_type: 'PlatformAdmin',
      entity_id: ownerId,
      tenant_id: null,
      performed_by_user_id: ownerId,
      approved_by_user_id: ownerId,
      approval_scope: ApprovalScope.PLATFORM_OPS_ACTION,
      new_values: { queue: name, count: retried },
    });
    return { retried };
  }
}
