import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FEE_NOTIFY_QUEUE } from './communications.constants';
import { FeeNotificationsListener } from './fee-notifications.listener';
import { InvoiceNotificationsListener } from './invoice-notifications.listener';

/**
 * [68.4.10] Runs the "new fees" and "receipt" family notices from Redis so a restart between
 * commit and send loses nothing. Handlers are idempotent per `reference_key`; errors are
 * rethrown so BullMQ retries.
 */
@Processor(FEE_NOTIFY_QUEUE)
export class FeeNotifyProcessor extends WorkerHost {
  constructor(
    private readonly feeNotifications: FeeNotificationsListener,
    private readonly invoiceNotifications: InvoiceNotificationsListener,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'fees.generated') {
      return this.feeNotifications.handleFeesGenerated(job.data);
    }
    if (job.name === 'payments.recorded') {
      return this.invoiceNotifications.handlePaymentRecorded(job.data);
    }
    throw new Error(`Unknown fee-notify job: ${job.name}`);
  }
}
