import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SCHOOL_TZ } from '../../../common/time';
import { isDemoMode } from '../../demo/demo-mode';
import { SmsExpiryService } from './sms-expiry.service';

export const SMS_EXPIRY_QUEUE = 'sms-expiry';
export const SMS_EXPIRY_JOB_ID = 'sms-expiry';
export const SMS_EXPIRY_CRON = '20 0 * * *';

/** Daily 00:20 school time, after the 00:10 seat job. #3866 registers the queue and provider. */
@Injectable()
@Processor(SMS_EXPIRY_QUEUE)
export class SmsExpiryScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SmsExpiryScheduler.name);

  constructor(
    @InjectQueue(SMS_EXPIRY_QUEUE) private readonly queue: Queue,
    private readonly expiry: SmsExpiryService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (isDemoMode()) {
      await this.queue.removeJobScheduler(SMS_EXPIRY_JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      SMS_EXPIRY_JOB_ID,
      { pattern: SMS_EXPIRY_CRON, tz: SCHOOL_TZ },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    try {
      await this.expiry.run(new Date());
    } catch (err) {
      // Rethrow so BullMQ records the failure; every step is idempotent, tomorrow retries.
      this.logger.error(`SMS expiry failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
