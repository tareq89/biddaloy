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
    // [77.2.10] D9: a school with Fees off gets no new automatic notice. A read failure is NOT
    // swallowed: it rethrows so BullMQ retries, because skipping would lose the event for good.
    const tenantId = job.name === 'payments.recorded' ? job.data?.tenant_id : job.data?.tenantId;
    if (tenantId && !(await isModuleOnForSchool(this.moduleState, tenantId, ModuleKey.fees))) {
      return;
    }
    if (job.name === 'fees.generated') {
      return this.feeNotifications.handleFeesGenerated(job.data);
    }
    if (job.name === 'payments.recorded') {
      return this.invoiceNotifications.handlePaymentRecorded(job.data);
    }
    throw new Error(`Unknown fee-notify job: ${job.name}`);
  }
}
