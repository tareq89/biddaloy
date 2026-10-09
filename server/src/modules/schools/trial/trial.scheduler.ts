import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TRIAL_QUEUE, TRIAL_JOB_ID, TRIAL_INTERVAL_MS } from './trial.constants';

/** Registers the daily job on boot; `upsertJobScheduler` is idempotent across restarts. */
@Injectable()
export class TrialScheduler implements OnModuleInit {
  constructor(@InjectQueue(TRIAL_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      TRIAL_JOB_ID,
      { every: TRIAL_INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
}
