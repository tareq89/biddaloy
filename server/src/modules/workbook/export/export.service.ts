import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import {
  WORKBOOK_EXPORT_JOB,
  WORKBOOK_EXPORT_QUEUE,
  WorkbookExportJobData,
} from './export.constants';

export interface RunExportInput {
  kind: WorkbookJobKind.EXPORT | WorkbookJobKind.SNAPSHOT;
  source: WorkbookJobSource;
  requestedByUserId: string | null;
}

/**
 * Request half of the export flow: inserts a `QUEUED` `workbook_jobs` row
 * and enqueues the BullMQ job that `ExportProcessor` picks up. Never
 * builds the workbook itself.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    @InjectQueue(WORKBOOK_EXPORT_QUEUE) private readonly queue: Queue<WorkbookExportJobData>,
    private readonly audit: AuditService,
  ) {}

  async run(tenantId: string, input: RunExportInput): Promise<WorkbookJob> {
    // The type narrows RESTORE out, but a JS caller (or a future controller
    // bug) can still get a RESTORE value past the compiler.
    if ((input.kind as WorkbookJobKind) === WorkbookJobKind.RESTORE) {
      throw new Error('ExportService.run does not accept WorkbookJobKind.RESTORE.');
    }

    const job = await this.jobs.save(
      this.jobs.create({
        tenant_id: tenantId,
        kind: input.kind,
        source: input.source,
        requested_by_user_id: input.requestedByUserId,
        status: WorkbookJobStatus.QUEUED,
        pinned: false,
      }),
    );

    try {
      await this.queue.add(
        WORKBOOK_EXPORT_JOB,
        { jobId: job.id, tenantId },
        {
          // BullMQ rejects custom job ids containing ':' — hyphen, not colon.
          jobId: `workbook-export-${job.id}`,
          attempts: 2,
          removeOnComplete: true,
          // See ExportModule's defaultJobOptions: keeps the failed set bounded.
          removeOnFail: 100,
        },
      );
    } catch (err) {
      // A row stuck QUEUED with no job behind it is indistinguishable from
      // "still waiting" in the UI — worse than a clean, visible failure.
      await this.jobs.update(job.id, {
        status: WorkbookJobStatus.FAILED,
        error: 'Could not be queued. Please try again.',
        finished_at: new Date(),
      });
      throw err;
    }

    // TODO(14.7): add dedicated EXPORT_* AuditAction + 'WorkbookJob' entity
    // type in shared/ — using AuditAction.CREATE / entity_type 'School' as
    // an interim stand-in (see the plan's correction C2).
    //
    // `AuditService.record` already fails open (catches and logs) without
    // a manager, but this call is wrapped defensively too: the job was
    // already accepted and enqueued above, and no audit hiccup should be
    // able to turn that already-decided outcome into a failed request.
    try {
      await this.audit.record({
        action: AuditAction.CREATE,
        entity_type: 'School',
        entity_id: job.id,
        tenant_id: tenantId,
        performed_by_user_id: input.requestedByUserId,
        new_values: {
          event: 'EXPORT_REQUESTED',
          workbook_job_id: job.id,
          kind: input.kind,
          source: input.source,
        },
      });
    } catch (err) {
      this.logger.error(
        `ExportService: audit write failed for job ${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return job;
  }
}
