import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SCHOOL_TZ } from '../../common/time';
import { isDemoMode } from '../demo/demo-mode';
import { SchoolsService } from '../schools/schools.service';
import { EntitlementService } from './entitlement.service';
import { SeatNoticesService } from './seat-notices.service';

export const BILLING_QUEUE = 'billing-recompute';
export const BILLING_JOB_ID = 'billing-recompute';
export const BILLING_CRON = '10 0 * * *';

/**
 * Daily 00:10 school time: orders that ended yesterday drop out of every school's `seat_limit`,
 * then the 30 / 7 / 0 day seat notices go out.
 */
@Injectable()
@Processor(BILLING_QUEUE)
export class BillingScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
    private readonly schools: SchoolsService,
    private readonly entitlement: EntitlementService,
    private readonly seatNotices: SeatNoticesService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Demo schools keep their unlimited seats, like the retired trial job.
    if (isDemoMode()) {
      await this.queue.removeJobScheduler(BILLING_JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      BILLING_JOB_ID,
      { pattern: BILLING_CRON, tz: SCHOOL_TZ },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    const now = new Date();
    let changed = 0;
    let failed = 0;
    for (const { id } of await this.schools.findAllActive()) {
      try {
        if (await this.entitlement.recomputeAndNotify(id, now)) changed++;
      } catch (err) {
        // One school's failure must not stop the rest; tomorrow's run retries it.
        failed++;
        this.logger.error(
          `Seat recompute failed for school ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(`Seat recompute done: ${changed} changed, ${failed} failed`);
    // After the recompute, so a school that just renewed is not warned. Its own errors never fail the job.
    try {
      await this.seatNotices.runDaily(now);
    } catch (err) {
      this.logger.error(`Seat notices failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
