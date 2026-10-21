import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SCHOOL_TZ } from '../../common/time';
import { isDemoMode } from '../demo/demo-mode';
import { IdleAccountService } from './idle-account.service';

export const IDLE_QUEUE = 'idle-account';
export const IDLE_JOB_ID = 'idle-account';
export const IDLE_CRON = '0 1 * * *';

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

  async process(): Promise<void> {
    await this.idle.runDaily(new Date());
  }
}
