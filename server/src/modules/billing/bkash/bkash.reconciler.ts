import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { Queue } from 'bullmq';
import { SmsBundleOrderSweepService } from '../../sms-bundles/orders/sms-bundle-order-sweep.service';
import { isDemoMode } from '../../demo/demo-mode';
import { BkashClient } from './bkash.client';
import { BkashService } from './bkash.service';

export const BKASH_RECONCILE_QUEUE = 'bkash-reconcile';
const JOB_ID = 'bkash-reconcile';

/** Every 10 min: settle PENDING orders (under 24 h) whose callback never arrived. */
@Injectable()
@Processor(BKASH_RECONCILE_QUEUE)
export class BkashReconciler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BkashReconciler.name);

  constructor(
    @InjectQueue(BKASH_RECONCILE_QUEUE) private readonly queue: Queue,
    private readonly client: BkashClient,
    private readonly bkash: BkashService,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (isDemoMode() || !this.client.isConfigured()) {
      await this.queue.removeJobScheduler(JOB_ID);
      return;
    }
    await this.queue.upsertJobScheduler(
      JOB_ID,
      { every: 10 * 60 * 1000 },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<void> {
    const paid = await this.bkash.reconcilePending();
    if (paid) this.logger.log(`bKash reconcile settled ${paid} order(s)`);
    // After settling, so an order paid in this pass is never cancelled. The sweep lives in
    // SmsBundlesModule (looked up lazily); a failure there must not fail the seat reconcile.
    try {
      const cancelled = await this.moduleRef
        .get(SmsBundleOrderSweepService, { strict: false })
        .cancelStale();
      if (cancelled) this.logger.log(`SMS bundle sweep cancelled ${cancelled} stale order(s)`);
    } catch (err) {
      this.logger.warn(`SMS bundle sweep skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
}
