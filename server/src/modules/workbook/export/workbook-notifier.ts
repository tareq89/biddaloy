import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobStatus,
  WorkbookJobSource,
} from '../jobs/workbook-job.entity';
import { WorkbookJobEventsService } from './workbook-job-events.service';
import { WorkbookJobFinishedPayload } from './export.constants';
import {
  AccountAccessDeliveryService,
  DeliverInput,
} from '../../account-access/account-access-delivery.service';
import { SchoolsService } from '../../schools/schools.service';
import { resolveTemplateLocale, TemplateKind } from '../../account-access/account-access-templates';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { buildBackupLink, failureReason, formatSizeMb, formatTimestamp } from './backup-email';

/**
 * "Your backup is ready" / "your backup failed" emails ([14.7.3] #601).
 * Subscribes to `WorkbookJobEventsService` (plain Node EventEmitter, not
 * `@nestjs/event-emitter`) rather than reacting to the BullMQ job itself,
 * so a notify bug can never fail the export.
 */
@Injectable()
export class WorkbookNotifier implements OnModuleInit {
  private readonly logger = new Logger(WorkbookNotifier.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    private readonly events: WorkbookJobEventsService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly schools: SchoolsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.events.onFinished((payload) => {
      void this.onJobFinished(payload);
    });
  }

  async onJobFinished(payload: WorkbookJobFinishedPayload): Promise<void> {
    try {
      // D9: only a job the admin actually asked for reports success. A
      // SCHEDULED run is routine, and a SNAPSHOT is the internal pre-restore
      // safety copy — emailing "your backup is ready, download it" for an
      // artefact nobody requested is noise at best and confusing at worst.
      // Failures always email, whatever the source. Checked before any DB read.
      if (
        payload.status === WorkbookJobStatus.DONE &&
        payload.source !== WorkbookJobSource.MANUAL
      ) {
        this.logger.debug(
          `Job ${payload.jobId} succeeded from source ${payload.source} — no email (D9).`,
        );
        return;
      }

      if (!payload.requestedByUserId) {
        this.logger.debug(`Job ${payload.jobId} has no requester — skipping notify.`);
        return;
      }

      const job = await this.jobs.findOne({
        where: { id: payload.jobId, tenant_id: payload.tenantId },
        relations: ['requested_by'],
      });
      if (!job) {
        this.logger.debug(
          `Job ${payload.jobId} not found for tenant ${payload.tenantId} — skipping notify.`,
        );
        return;
      }

      const email = job.requested_by?.email;
      if (!email) {
        this.logger.debug(`Job ${payload.jobId}'s requester has no email — skipping notify.`);
        return;
      }

      const settings = await this.schools.getResolvedSettings(payload.tenantId);
      const locale = resolveTemplateLocale(settings.region?.locale);
      const timezone = settings.region?.timezone ?? 'UTC';

      // RESTORE jobs get their own DONE/FAILED templates — [14.10.3] (#609).
      // The link always points at the pre-restore SNAPSHOT (not the restore
      // job itself, which has no downloadable artefact): it is what lets
      // the admin roll back, on both success and failure.
      const isRestore = payload.kind === WorkbookJobKind.RESTORE;
      const kind: TemplateKind = isRestore
        ? payload.status === WorkbookJobStatus.DONE
          ? 'RESTORE_DONE'
          : 'RESTORE_FAILED'
        : payload.status === WorkbookJobStatus.DONE
          ? 'BACKUP_READY'
          : 'BACKUP_FAILED';

      const linkJobId = isRestore ? (job.snapshot_job_id ?? payload.jobId) : payload.jobId;

      const input: DeliverInput = {
        tenantId: payload.tenantId,
        medium: CommunicationMedium.EMAIL,
        to: email,
        recipientName: job.requested_by!.full_name,
        kind,
        vars: {
          link: buildBackupLink(resolveAppBaseUrl(this.config), linkJobId),
          size_mb: formatSizeMb(payload.sizeBytes),
          finished_at: formatTimestamp(job.finished_at, locale, timezone),
          expires_at: formatTimestamp(job.expires_at, locale, timezone),
          reason: failureReason(payload.error),
        },
        metadata: { workbook_job_id: payload.jobId },
      };

      await this.delivery.deliver(input);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to notify for workbook job ${payload.jobId}: ${reason}`);
    }
  }
}
