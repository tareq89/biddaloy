import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  REFRESH_TOKEN_CLEANUP_QUEUE,
  REFRESH_TOKEN_CLEANUP_JOB_ID,
  REFRESH_TOKEN_CLEANUP_INTERVAL_MS,
} from "./refresh-token-cleanup.constants";

/**
 * Registers the repeatable cleanup job on boot. BullMQ dedupes a repeatable
 * job by its jobId + repeat options, so calling add() again on every
 * restart is idempotent rather than piling up duplicate schedules.
 */
@Injectable()
export class RefreshTokenCleanupScheduler implements OnModuleInit {
  private readonly logger = new Logger(RefreshTokenCleanupScheduler.name);

  constructor(@InjectQueue(REFRESH_TOKEN_CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      REFRESH_TOKEN_CLEANUP_JOB_ID,
      {},
      {
        jobId: REFRESH_TOKEN_CLEANUP_JOB_ID,
        repeat: { every: REFRESH_TOKEN_CLEANUP_INTERVAL_MS },
        // BullMQ keeps finished jobs by default, so an hourly job would
        // otherwise accumulate Redis state forever. No need to inspect a
        // completed cleanup run; failed ones are worth a bounded amount of
        // history to diagnose.
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    this.logger.log(`Scheduled refresh token cleanup every ${REFRESH_TOKEN_CLEANUP_INTERVAL_MS}ms`);
  }
}
