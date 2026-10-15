import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { DigestScheduleService } from './digest-schedule.service';
import {
  DASHBOARD_DIGEST_QUEUE,
  DIGEST_RECONCILE_ID,
  DIGEST_RECONCILE_INTERVAL_MS,
  DIGEST_RECONCILE_JOB,
  DIGEST_RECONCILE_RETRY_MS,
  DIGEST_RUN_JOB,
  DigestJobData,
} from './digest.constants';

/** Worker for `dashboard-digest`: the hourly reconciler plus each school's morning tick. */
@Injectable()
@Processor(DASHBOARD_DIGEST_QUEUE, { concurrency: 5 })
export class DigestScheduleProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestScheduleProcessor.name);
  private reconcileRetry?: NodeJS.Timeout;

  constructor(
    @InjectQueue(DASHBOARD_DIGEST_QUEUE) private readonly queue: Queue<DigestJobData>,
    private readonly service: DigestScheduleService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Redis or the DB being briefly down at boot must not stop the server from starting.
    await this.registerReconciler();
    try {
      await this.service.syncAll();
    } catch (err) {
      this.logger.error(`initial digest syncAll failed: ${String(err)}`);
    }
  }

  onModuleDestroy(): void {
    if (this.reconcileRetry) clearTimeout(this.reconcileRetry);
  }

  private async registerReconciler(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        DIGEST_RECONCILE_ID,
        { every: DIGEST_RECONCILE_INTERVAL_MS },
        { name: DIGEST_RECONCILE_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
      );
      this.reconcileRetry = undefined;
    } catch (err) {
      this.logger.error(`digest reconciler registration failed, retrying: ${String(err)}`);
      this.reconcileRetry = setTimeout(() => {
        void this.registerReconciler();
      }, DIGEST_RECONCILE_RETRY_MS);
      this.reconcileRetry.unref();
    }
  }

  async process(job: Job<DigestJobData>): Promise<void> {
    switch (job.name) {
      case DIGEST_RECONCILE_JOB:
        await this.service.syncAll();
        return;
      case DIGEST_RUN_JOB:
        await this.service.runNow(job.data.tenantId, job.data.deferred === true);
        return;
      default:
        this.logger.warn(`unknown digest job '${job.name}' - skipping`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DigestJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error({ msg: 'digest job failed', job_name: job.name, error: err?.message });
    Sentry.withScope((scope) => {
      scope.setTags({
        queue: DASHBOARD_DIGEST_QUEUE,
        job_name: job.name,
        tenant_id: job.data?.tenantId,
      });
      Sentry.captureException(err);
    });
  }
}
