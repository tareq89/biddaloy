import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { tenantObjectKey } from '../../storage/storage-key';
import { School } from '../../schools/entities/school.entity';
import { ALL_TABS, assertRegistryValid, EXPECTED_TABS } from '../codec/registry';
import { writeWorkbook } from '../codec/workbook-codec';
import { SCHEMA_VERSION, WorkbookMeta } from '../codec/meta';
import type { ExportContext, TabSpec } from '../codec/tab-spec';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobProgress,
  WorkbookJobStatus,
  WorkbookRowCounts,
} from '../jobs/workbook-job.entity';
import {
  BACKUP_STORAGE_CATEGORY,
  EXPORT_RETENTION_DAYS,
  WORKBOOK_EXPORT_QUEUE,
  WorkbookExportJobData,
  XLSX_MIME,
} from './export.constants';
import { WorkbookJobEventsService } from './workbook-job-events.service';

/** Coarse cadence for progress writes — never per row, which would be one
 * UPDATE per student. */
const PROGRESS_FLUSH_INTERVAL = 500;

/** A small, fixed set of user-facing failure strings. Never the raw error
 * message and never a stack trace — driver output can carry table names,
 * SQL and tenant values (see the entity's own comment on `error`). */
function sanitiseExportError(stage: 'READ' | 'STORE' | 'UNKNOWN'): string {
  switch (stage) {
    case 'READ':
      return 'Could not read school data.';
    case 'STORE':
      return 'Could not save the backup file.';
    default:
      return 'Unexpected error while building the backup.';
  }
}

/**
 * Worker half of the export flow. Streams every tab in `ALL_TABS` into an
 * `.xlsx`, one tab (and one `EntityManager.find` call) at a time, then puts
 * the finished buffer in object storage and moves the job row to a terminal
 * status. Never wraps steps 3-7 in a DB transaction — holding a transaction
 * open across a multi-minute build and an S3 round-trip would pin a
 * Postgres connection and block vacuum, and the row updates below are
 * independent single statements by design.
 */
@Processor(WORKBOOK_EXPORT_QUEUE, { concurrency: 1 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: WorkbookJobEventsService,
  ) {
    super();
  }

  async process(job: Job<WorkbookExportJobData>): Promise<void> {
    const { jobId, tenantId } = job.data;

    // Always both columns — never by id alone. Tenant isolation is
    // mandatory, and a mismatched tenant_id must behave like "not found".
    const row = await this.jobs.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!row) {
      this.logger.warn(`ExportProcessor: job row ${jobId} (tenant ${tenantId}) not found.`);
      return;
    }
    if (row.status === WorkbookJobStatus.DONE) {
      // Idempotent replay — a stalled-job recovery or a redelivered event
      // must not rebuild and re-upload a finished export.
      return;
    }

    await this.jobs.update(row.id, { status: WorkbookJobStatus.RUNNING, progress: null });

    let currentTab: string | null = null;
    let stage: 'READ' | 'STORE' | 'UNKNOWN' = 'READ';

    try {
      const manager = this.dataSource.manager;

      const school = await manager.findOne(School, { where: { id: tenantId } });
      if (!school) {
        throw new Error(`ExportProcessor: tenant ${tenantId} has no School row.`);
      }

      const meta: WorkbookMeta = {
        schema_version: SCHEMA_VERSION,
        kind: row.kind === WorkbookJobKind.SNAPSHOT ? 'SNAPSHOT' : 'BACKUP',
        exported_at: new Date().toISOString(),
        // `resolveJsonModule` is not enabled in server/tsconfig.json, so
        // package.json cannot be imported here for the version.
        app_version: process.env.APP_VERSION ?? 'unknown',
        source_school_name: school.name,
        source_school_slug: school.slug,
      };

      // Mirrors WorkbookModule's own boot check, so a bad registry fails
      // this job instead of silently producing a workbook missing sheets.
      assertRegistryValid(ALL_TABS, { partial: ALL_TABS.length < EXPECTED_TABS.length });

      const rowCounts: WorkbookRowCounts = {};
      // TODO(14.x): no currently-registered tab in ALL_TABS calls ctx.keyOf,
      // so this placeholder is never exercised. It is NOT a real natural key —
      // codec/tab-spec.ts documents keyOf as returning the natural key a
      // foreign-row cell references, which must survive across schools (a
      // KeyIndex-backed lookup), not a tenant-local uuid. Replace this with a
      // real KeyIndex before any wave-3/4 tab exports an FK column, or this
      // will silently write unusable cross-school references.
      const ctx: ExportContext = {
        keyOf: () => {
          throw new Error('ExportContext.keyOf is not implemented yet (see TODO above)');
        },
      };

      stage = 'READ';
      const buffer = await writeWorkbook({
        tabs: ALL_TABS,
        meta,
        rowsFor: (tab) =>
          this.rowsFor(tab, row, manager, ctx, rowCounts, (name) => {
            currentTab = name;
          }),
      });

      stage = 'STORE';
      const key = tenantObjectKey(tenantId, BACKUP_STORAGE_CATEGORY, 'xlsx');
      await this.storage.put(key, buffer, XLSX_MIME);

      const finishedAt = new Date();
      const expiresAt = new Date(finishedAt.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      await this.jobs.update(row.id, {
        status: WorkbookJobStatus.DONE,
        storage_key: key,
        size_bytes: String(buffer.byteLength),
        row_counts: rowCounts,
        expires_at: expiresAt,
        finished_at: finishedAt,
        error: null,
        failed_tab: null,
      });

      // TODO(14.7): add dedicated EXPORT_* AuditAction + 'WorkbookJob'
      // entity type in shared/ — using AuditAction.CREATE / entity_type
      // 'School' as an interim stand-in (see the plan's correction C2).
      await this.audit.record({
        action: AuditAction.CREATE,
        entity_type: 'School',
        entity_id: row.id,
        tenant_id: tenantId,
        performed_by_user_id: row.requested_by_user_id,
        new_values: {
          event: 'EXPORT_COMPLETED',
          workbook_job_id: row.id,
          row_counts: rowCounts,
          size_bytes: String(buffer.byteLength),
          storage_key: key,
        },
      });

      this.safeEmit({
        jobId: row.id,
        tenantId,
        kind: row.kind,
        source: row.source,
        status: WorkbookJobStatus.DONE,
        requestedByUserId: row.requested_by_user_id,
        storageKey: key,
        sizeBytes: String(buffer.byteLength),
        rowCounts,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const sanitised = sanitiseExportError(stage);

      // Guard the status write itself: a row left RUNNING forever is the
      // failure mode the tests assert against.
      try {
        await this.jobs.update(row.id, {
          status: WorkbookJobStatus.FAILED,
          error: sanitised,
          failed_tab: currentTab,
          finished_at: new Date(),
        });
      } catch (updateErr) {
        this.logger.error(
          `ExportProcessor: failed to write FAILED status for job ${row.id}: ${
            updateErr instanceof Error ? updateErr.message : String(updateErr)
          }`,
        );
      }

      this.logger.error(
        `ExportProcessor: export job ${row.id} (tenant ${tenantId}) failed at "${currentTab ?? 'n/a'}": ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      Sentry.withScope((scope) => {
        scope.setTags({
          queue: WORKBOOK_EXPORT_QUEUE,
          workbook_job_id: row.id,
          tenant_id: tenantId,
        });
        Sentry.captureException(err instanceof Error ? err : new Error(message));
      });

      // TODO(14.7): add dedicated EXPORT_* AuditAction + 'WorkbookJob'
      // entity type in shared/ — using AuditAction.CREATE / entity_type
      // 'School' as an interim stand-in (see the plan's correction C2).
      await this.audit.record({
        action: AuditAction.CREATE,
        entity_type: 'School',
        entity_id: row.id,
        tenant_id: tenantId,
        performed_by_user_id: row.requested_by_user_id,
        new_values: {
          event: 'EXPORT_FAILED',
          workbook_job_id: row.id,
          failed_tab: currentTab,
          error: sanitised,
        },
      });

      this.safeEmit({
        jobId: row.id,
        tenantId,
        kind: row.kind,
        source: row.source,
        status: WorkbookJobStatus.FAILED,
        requestedByUserId: row.requested_by_user_id,
        storageKey: null,
        sizeBytes: null,
        rowCounts: null,
        error: sanitised,
      });

      // Rethrow so BullMQ burns the second attempt. On the retry, step 1
      // sees FAILED (not DONE) and runs again from RUNNING.
      throw err;
    }
  }

  /**
   * Streams one tab's rows, updates the running row count, and writes
   * coarse progress every `PROGRESS_FLUSH_INTERVAL` rows plus once at the
   * end — never per row, which would be one UPDATE per student. One tab's
   * entities are resident at a time; never `Promise.all` over tabs.
   */
  private async *rowsFor(
    tab: TabSpec<any, any>,
    row: WorkbookJob,
    manager: EntityManager,
    ctx: ExportContext,
    rowCounts: WorkbookRowCounts,
    onTabStart: (name: string) => void,
  ): AsyncGenerator<Record<string, unknown>> {
    onTabStart(tab.name);
    const entities = await tab.load(row.tenant_id, manager);
    rowCounts[tab.name] = 0;

    let done = 0;
    const total = entities.length;
    for (const entity of entities) {
      yield tab.toRow(entity, ctx);
      rowCounts[tab.name] += 1;
      done += 1;
      if (done % PROGRESS_FLUSH_INTERVAL === 0) {
        await this.writeProgress(row.id, { tab: tab.name, done, total });
      }
    }
    await this.writeProgress(row.id, { tab: tab.name, done, total });
  }

  private async writeProgress(jobId: string, progress: WorkbookJobProgress): Promise<void> {
    try {
      await this.jobs.update(jobId, { progress });
    } catch (err) {
      // Progress is a UX nicety, not correctness — never let a progress
      // write failure abort or fail the export.
      this.logger.warn(
        `ExportProcessor: failed to write progress for job ${jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Never let a listener bug fail an otherwise-successful (or already
   * terminal) export. */
  private safeEmit(payload: Parameters<WorkbookJobEventsService['emitFinished']>[0]): void {
    try {
      this.events.emitFinished(payload);
    } catch (err) {
      this.logger.error(
        `ExportProcessor: WORKBOOK_JOB_FINISHED listener threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WorkbookExportJobData> | undefined, err: Error): void {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;
    this.logger.error({
      msg: 'workbook export job failed permanently',
      queue: WORKBOOK_EXPORT_QUEUE,
      workbook_job_id: job.data.jobId,
      tenant_id: job.data.tenantId,
      error: err?.message,
    });
    Sentry.withScope((scope) => {
      scope.setTags({
        queue: WORKBOOK_EXPORT_QUEUE,
        workbook_job_id: job.data.jobId,
        tenant_id: job.data.tenantId,
      });
      Sentry.captureException(err);
    });
  }
}
