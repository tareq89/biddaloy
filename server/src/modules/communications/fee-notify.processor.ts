import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ModuleKey } from '@biddaloy/shared';
import { ModuleStateReader } from '../auth/guards/module-state.reader';
import { isModuleOnForSchool } from '../schools/settings/school-modules.util';
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
    private readonly moduleState: ModuleStateReader,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'fees.generated' && job.name !== 'payments.recorded') {
      throw new Error(`Unknown fee-notify job: ${job.name}`);
    }
    // [77.2.10] D9: a school with Fees off gets no new automatic notice. A read failure is NOT
    // swallowed: it rethrows so BullMQ retries, because skipping would lose the event for good.
    const tenantId = job.name === 'payments.recorded' ? job.data?.tenant_id : job.data?.tenantId;
    // A job without a tenant id cannot be gated, so it fails (never runs as if Fees were on).
    if (!tenantId) throw new Error(`fee-notify job ${job.name} has no tenant id`);
    if (!(await isModuleOnForSchool(this.moduleState, tenantId, ModuleKey.fees))) {
      return;
    }
    return job.name === 'fees.generated'
      ? this.feeNotifications.handleFeesGenerated(job.data)
      : this.invoiceNotifications.handlePaymentRecorded(job.data);
  }
}
