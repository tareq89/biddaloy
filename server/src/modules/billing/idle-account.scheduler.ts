import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SCHOOL_TZ } from '../../common/time';
import { isDemoMode } from '../demo/demo-mode';
import { IdleAccountService } from './idle-account.service';

export const IDLE_QUEUE = 'idle-account';
export const IDLE_JOB_ID = 'idle-account';
export const IDLE_CRON = '0 1 * * *';
/** The retired daily trial job (Epic 49 #2716). Existing Redis may still hold its scheduler. */
export const LEGACY_TRIAL_QUEUE = 'trial-lifecycle';

/** Daily 01:00 school time: notices, idle suspensions and soft deletes. Skipped in demo mode. */
@Injectable()
@Processor(IDLE_QUEUE)
export class IdleAccountScheduler extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue(IDLE_QUEUE) private readonly queue: Queue,
    private readonly idle: IdleAccountService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.removeLegacyTrialJob();
    if (isDemoMode()) {
      await this.queue.removeJobScheduler(IDLE_JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      IDLE_JOB_ID,
      { pattern: IDLE_CRON, tz: SCHOOL_TZ },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  /** Idempotent: removing a scheduler that is not there is a no-op. Never blocks boot. */
  private async removeLegacyTrialJob(): Promise<void> {
    const legacy = new Queue(LEGACY_TRIAL_QUEUE, { connection: this.queue.opts.connection });
    try {
      await legacy.removeJobScheduler(LEGACY_TRIAL_QUEUE);
    } catch (err) {
      new Logger(IdleAccountScheduler.name).warn(
        `Could not remove the retired ${LEGACY_TRIAL_QUEUE} job: ${(err as Error).message}`,
      );
    } finally {
      await legacy.close().catch(() => undefined);
    }
  }

  async process(): Promise<void> {
    await this.idle.runDaily(new Date());
  }
}
