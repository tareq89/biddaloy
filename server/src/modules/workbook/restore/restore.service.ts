import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { ImportStagingService, BULK_IMPORT_REDIS } from '../../bulk-import/import-staging.service';
import { School } from '../../schools/entities/school.entity';
import type { StagedValidation } from '../import/import.controller';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import { ExportService } from '../export/export.service';
import { WORKBOOK_RESTORE_JOB, WORKBOOK_RESTORE_QUEUE, RestoreJobData } from './restore.constants';
import { acquire, release, renew } from './restore-lock';

export interface RequestRestoreInput {
  staging_id: string;
  confirmation: string;
  invite_users?: boolean;
}

export interface RequestRestoreResult {
  job: WorkbookJob;
  snapshotJob: WorkbookJob;
}

/**
 * Request half of the restore flow: runs every guard before anything
 * destructive happens (stage exists and is error-free, the admin typed
 * the school name, no other restore is running for this tenant), takes a
 * safety SNAPSHOT, then inserts a `QUEUED` `workbook_jobs` RESTORE row and
 * enqueues the BullMQ job a later processor (14.10.2) picks up. Never
 * applies the restore itself.
 */
@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectQueue(WORKBOOK_RESTORE_QUEUE) private readonly queue: Queue<RestoreJobData>,
    private readonly staging: ImportStagingService,
    private readonly exportService: ExportService,
    private readonly audit: AuditService,
    @Inject(BULK_IMPORT_REDIS) private readonly redis: Redis,
  ) {}

  async request(
    tenantId: string,
    userId: string,
    input: RequestRestoreInput,
  ): Promise<RequestRestoreResult> {
    // Peek, never consume — a refused or interrupted request must still
    // find the stage on a retry.
    const staged = await this.staging.peek<StagedValidation>(tenantId, userId, input.staging_id);
    if (staged === null) {
      throw new NotFoundException({
        code: 'RESTORE_STAGE_NOT_FOUND',
        message: 'Staged import not found or expired.',
      });
    }

    if (staged.hardErrorCount > 0) {
      throw new ConflictException({
        code: 'RESTORE_HAS_ERRORS',
        message: 'Staged workbook has validation errors and cannot be restored.',
      });
    }

    const school = await this.schools.findOneOrFail({ where: { id: tenantId } });
    if (input.confirmation.trim() !== school.name) {
      // Message never echoes the expected school name.
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: 'Confirmation text does not match.',
      });
    }

    // The lock token IS the restore job's id (generated up front so the row
    // can be created with it) — 14.10.2's processor releases the lock with
    // this same job id, so the two must match or the lock never clears.
    const jobId = randomUUID();
    const acquired = await acquire(this.redis, tenantId, jobId);
    if (!acquired) {
      throw new ConflictException({
        code: 'RESTORE_IN_PROGRESS',
        message: 'A restore is already in progress for this school.',
      });
    }

    try {
      const snapshotJob = await this.exportService.run(tenantId, {
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        requestedByUserId: userId,
      });

      const job = await this.jobs.save(
        this.jobs.create({
          id: jobId,
          tenant_id: tenantId,
          kind: WorkbookJobKind.RESTORE,
          source: WorkbookJobSource.MANUAL,
          requested_by_user_id: userId,
          status: WorkbookJobStatus.QUEUED,
          staging_id: input.staging_id,
          snapshot_job_id: snapshotJob.id,
          pinned: false,
        }),
      );

      await this.queue.add(
        WORKBOOK_RESTORE_JOB,
        { jobId: job.id, inviteUsers: input.invite_users ?? false },
        {
          // BullMQ rejects custom job ids containing ':' — hyphen, not colon.
          jobId: `workbook-restore-${job.id}`,
          attempts: 1,
        },
      );

      // See ExportService's convention (and the plan's correction C2):
      // there is no dedicated RESTORE_* AuditAction yet, so this reuses
      // AuditAction.CREATE / entity_type 'School' with the real event
      // name in new_values.event. Wrapped defensively: the job is already
      // accepted and enqueued, so an audit hiccup must not fail the
      // request.
      try {
        await this.audit.record({
          action: AuditAction.CREATE,
          entity_type: 'School',
          entity_id: job.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: {
            event: 'RESTORE_REQUESTED',
            workbook_job_id: job.id,
            staging_id: input.staging_id,
            snapshot_job_id: snapshotJob.id,
            totals: staged.totals,
          },
        });
      } catch (err) {
        this.logger.error(
          `RestoreService: audit write failed for job ${job.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return { job, snapshotJob };
    } catch (err) {
      // The `jobs.save` above may already have committed a QUEUED row (e.g.
      // when `queue.add` is what threw) — leaving it QUEUED with no worker
      // ever picking it up would strand it forever. Best-effort mark it
      // FAILED so it shows up as a terminal outcome instead of a silent
      // stuck job; this must never mask the original error.
      await this.jobs
        .update(jobId, {
          status: WorkbookJobStatus.FAILED,
          error: err instanceof Error ? err.message : String(err),
          finished_at: new Date(),
        })
        .catch((updateErr) => {
          this.logger.error(
            `RestoreService: failed to mark job ${jobId} FAILED after enqueue error: ${
              updateErr instanceof Error ? updateErr.message : String(updateErr)
            }`,
          );
        });

      try {
        await release(this.redis, tenantId, jobId);
      } catch (releaseErr) {
        this.logger.error(
          `Failed to release restore lock for tenant ${tenantId}, job ${jobId}: ${
            releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
          }`,
        );
      }
      throw err;
    }
  }

  /** Public: 14.10.2's processor calls this on every terminal outcome. */
  async release(tenantId: string, jobId: string): Promise<void> {
    await release(this.redis, tenantId, jobId);
  }

  /** Public: 14.10.2's processor calls this periodically while a restore is
   * running, so a slow/long restore's lock never expires out from under
   * it (RESTORE_LOCK_TTL_SEC bounds a *stuck* job, not a legitimately slow
   * one). Returns `false` if the lock was already lost — the processor
   * treats that as a fatal condition, since another restore may now be
   * running concurrently for the same tenant. */
  async renewLock(tenantId: string, jobId: string): Promise<boolean> {
    return renew(this.redis, tenantId, jobId);
  }
}
