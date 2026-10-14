import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { isDemoMode } from '../../demo/demo-mode';
import { TRIAL_QUEUE, TRIAL_JOB_ID, TRIAL_INTERVAL_MS } from './trial.constants';

/** Registers the daily job on boot; `upsertJobScheduler` is idempotent across restarts. */
@Injectable()
export class TrialScheduler implements OnModuleInit {
  constructor(@InjectQueue(TRIAL_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // [58.1.02] Demo schools must never be suspended by an expiring trial.
    if (isDemoMode()) {
      await this.queue.removeJobScheduler(TRIAL_JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      TRIAL_JOB_ID,
      { every: TRIAL_INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
}
