import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SchoolsService } from '../../schools/schools.service';
import { ExportService } from '../export/export.service';
import { WorkbookJobKind, WorkbookJobSource } from '../jobs/workbook-job.entity';
import {
  BACKUP_SCHEDULE_CRON,
  BACKUP_SCHEDULE_QUEUE,
  BACKUP_SCHEDULE_RUN_JOB,
  BackupScheduleJobData,
  schedulerIdFor,
} from './backup-schedule.constants';

/**
 * `backup.schedule` (14.12.1/#615). Keeps one BullMQ job scheduler per
 * ACTIVE, non-OFF tenant in sync with `schools.settings`, and hands the
 * actual export off to `ExportService.run` — the only code path that
 * creates the `WorkbookJob` row, uses the right job name/id, and marks
 * FAILED on an enqueue throw (plan correction C3).
 *
 * NOTE: there is deliberately no settings-save -> resync hook here (plan
 * Step 6) — `SchoolsModule` already imports nothing from this module's
 * dependency chain and adding one would require a `forwardRef` cycle
 * (`BackupScheduleModule` -> `ExportModule` -> `SchoolsModule`). The
 * hourly reconciler (`BackupScheduleProcessor`) is the safety net instead:
 * a schedule change takes effect within at most one hour.
 */
@Injectable()
export class BackupScheduleService {
  private readonly logger = new Logger(BackupScheduleService.name);

  constructor(
    @InjectQueue(BACKUP_SCHEDULE_QUEUE) private readonly queue: Queue<BackupScheduleJobData>,
    private readonly schools: SchoolsService,
    private readonly exports: ExportService,
  ) {}

  /** Re-derives one tenant's scheduler from its current settings + status. */
  async sync(tenantId: string): Promise<void> {
    const school = await this.schools.findById(tenantId);
    const id = schedulerIdFor(tenantId);

    if (school.status !== 'ACTIVE') {
      await this.queue.removeJobScheduler(id);
      return;
    }

    const settings = await this.schools.getResolvedSettings(tenantId);
    const mode = settings.backup?.schedule ?? 'OFF';
    if (mode === 'OFF') {
      await this.queue.removeJobScheduler(id);
      return;
    }

    await this.queue.upsertJobScheduler(
      id,
      { pattern: BACKUP_SCHEDULE_CRON[mode], tz: settings.region?.timezone ?? 'Asia/Dhaka' },
      {
        name: BACKUP_SCHEDULE_RUN_JOB,
        data: { tenantId },
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  /** Full sweep, run on boot and hourly (C4). One broken school never
   * aborts the rest. Every school is visited, not just ACTIVE ones:
   * `sync()` removes a non-ACTIVE school's scheduler, and nothing else
   * does — `SchoolsService.updateStatus` has no hook here (see the
   * class comment), so this hourly pass is what stops a suspended school's
   * scheduler from lingering until its own next tick (a week, for WEEKLY). */
  async syncAll(): Promise<void> {
    const schools = await this.schools.findAll();
    for (const school of schools) {
      try {
        await this.sync(school.id);
      } catch (err) {
        this.logger.error(
          `BackupScheduleService: sync failed for tenant ${school.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Fired by a BullMQ tick. Re-checks status/mode at run time (C7) since
   * the scheduler may have gone stale between ticks. */
  async runNow(tenantId: string): Promise<void> {
    const school = await this.schools.findById(tenantId);
    const settings = await this.schools.getResolvedSettings(tenantId);
    const mode = settings.backup?.schedule ?? 'OFF';

    if (school.status !== 'ACTIVE' || mode === 'OFF') {
      // Stale scheduler — clean it up rather than leaving it to tick
      // pointlessly forever.
      await this.sync(tenantId);
      return;
    }

    await this.exports.run(tenantId, {
      kind: WorkbookJobKind.EXPORT,
      source: WorkbookJobSource.SCHEDULED,
      requestedByUserId: null,
    });
  }
}
