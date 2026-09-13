import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { BackupScheduleService } from './backup-schedule.service';
import {
  BACKUP_SCHEDULE_QUEUE,
  BACKUP_SCHEDULE_RECONCILE_ID,
  BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS,
  BACKUP_SCHEDULE_RECONCILE_JOB,
  BACKUP_SCHEDULE_RECONCILE_RETRY_MS,
  BACKUP_SCHEDULE_RUN_JOB,
  BackupScheduleJobData,
} from './backup-schedule.constants';

/**
 * Worker for `workbook-backup-schedule` (plan correction C1: a repeatable
 * job cannot go on `workbook-export` — `ExportProcessor` never dispatches
 * on `job.name`). This class *does* dispatch on `job.name`, which is the
 * thing that queue lacks.
 *
 * Kept separate from `BackupScheduleService` (unlike
 * `AbsenceNoticeScheduler`, which is both `@Injectable` and `@Processor`
 * in one class) because `BackupScheduleService` is the thing #616/#617
 * import directly — it should not also carry queue-wiring concerns.
 */
@Injectable()
@Processor(BACKUP_SCHEDULE_QUEUE, { concurrency: 1 })
export class BackupScheduleProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduleProcessor.name);

  constructor(
    @InjectQueue(BACKUP_SCHEDULE_QUEUE) private readonly queue: Queue<BackupScheduleJobData>,
    private readonly service: BackupScheduleService,
  ) {
    super();
  }

  private reconcileRetry?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    // Redis or the DB being briefly unavailable at boot must not stop the
    // server from starting. Both the scheduler registration and the
    // initial sync are covered: an unguarded upsertJobScheduler would
    // otherwise reject onModuleInit and fail the whole app bootstrap over
    // a transient Redis hiccup.
    await this.registerReconciler();

    try {
      await this.service.syncAll();
    } catch (err) {
      this.logger.error(
        `BackupScheduleProcessor: initial syncAll failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.reconcileRetry) clearTimeout(this.reconcileRetry);
  }

  /** The hourly reconciler is the safety net for every other drift in this
   * module (C4), so its own registration can't be fire-and-forget: if the
   * upsert fails at boot, nothing else ever re-registers it and this
   * process runs with no reconciler for its whole life. Retry until it
   * lands; `unref()` so a pending retry never keeps the process alive. */
  private async registerReconciler(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        BACKUP_SCHEDULE_RECONCILE_ID,
        { every: BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS },
        {
          name: BACKUP_SCHEDULE_RECONCILE_JOB,
          opts: { removeOnComplete: true, removeOnFail: 100 },
        },
      );
      this.reconcileRetry = undefined;
    } catch (err) {
      this.logger.error(
        `BackupScheduleProcessor: failed to register reconcile scheduler, retrying in ${
          BACKUP_SCHEDULE_RECONCILE_RETRY_MS
        }ms: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.reconcileRetry = setTimeout(() => {
        void this.registerReconciler();
      }, BACKUP_SCHEDULE_RECONCILE_RETRY_MS);
      this.reconcileRetry.unref();
    }
  }

  async process(job: Job<BackupScheduleJobData>): Promise<void> {
    switch (job.name) {
      case BACKUP_SCHEDULE_RECONCILE_JOB:
        await this.service.syncAll();
        return;
      case BACKUP_SCHEDULE_RUN_JOB:
        await this.service.runNow(job.data.tenantId);
        return;
      default:
        this.logger.warn(`BackupScheduleProcessor: unknown job name '${job.name}' — skipping.`);
        return;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BackupScheduleJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error({
      msg: 'backup schedule job failed',
      queue: BACKUP_SCHEDULE_QUEUE,
      job_name: job.name,
      tenant_id: job.data?.tenantId,
      error: err?.message,
    });
    Sentry.withScope((scope) => {
      scope.setTags({
        queue: BACKUP_SCHEDULE_QUEUE,
        job_name: job.name,
        tenant_id: job.data?.tenantId,
      });
      Sentry.captureException(err);
    });
  }
}
