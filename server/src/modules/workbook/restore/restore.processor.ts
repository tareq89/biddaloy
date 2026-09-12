import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { ImportStagingService } from '../../bulk-import/import-staging.service';
import { InvitationService } from '../../account-access/invitation.service';
import { ALL_TABS } from '../codec/registry';
import { KeyIndex } from '../codec/key-index';
import { ValidationService } from '../import/validation.service';
import type { StagedValidation } from '../import/import.controller';
import {
  WorkbookJob,
  WorkbookJobProgress,
  WorkbookJobStatus,
  WorkbookRowCounts,
} from '../jobs/workbook-job.entity';
import { WorkbookJobEventsService } from '../export/workbook-job-events.service';
import { WORKBOOK_RESTORE_QUEUE, RestoreJobData } from './restore.constants';
import { RestoreService } from './restore.service';

/** How often to poll the snapshot job row while waiting for it to finish. */
const SNAPSHOT_POLL_INTERVAL_MS = 2000;

/** Give up waiting for the snapshot after this long — a stuck snapshot must
 * not hang the restore job forever. */
const SNAPSHOT_MAX_WAIT_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Matches the `pending:<tab>:<key>` placeholder `ValidationService.validate`
 * writes into a row's ref field when the referenced row does not exist yet
 * in the destination (see `validation.service.ts`'s `ctx.ref`) — it cannot
 * be a real id at validate time because nothing has been inserted yet.
 * The tab name is never itself a colon, so a non-greedy split on the first
 * two colons is exact. */
const PENDING_REF_PATTERN = /^pending:([^:]+):([\s\S]*)$/;

/**
 * Walks a validated row (a plain object of primitives/arrays — never a live
 * entity) and replaces every `pending:<tab>:<key>` placeholder with the real
 * id that tab's row now has, using the live per-tab `KeyIndex`es this
 * processor built as it applied earlier tabs. `ALL_TABS` order guarantees a
 * tab is only ever applied after every tab it can reference (registry.ts's
 * `assertRegistryValid`), so the target tab's index is always populated by
 * the time a later tab needs it — a self-reference within the same tab is
 * covered too, since the current tab's own index is updated after each row.
 *
 * Generic (not per-tab-specific) because the placeholder already carries the
 * target tab name — no column metadata is needed to know which tab a
 * reference targets.
 */
function resolvePendingRefs(value: unknown, indexes: Map<string, KeyIndex>): unknown {
  if (typeof value === 'string') {
    const match = PENDING_REF_PATTERN.exec(value);
    if (!match) return value;
    const [, refTab, key] = match;
    const resolved = indexes.get(refTab)?.get(key);
    if (resolved === undefined) {
      // Failing open here would write the literal placeholder string into a
      // real column (silently, if the column is text/jsonb) — never do that.
      throw new Error(`Unresolved reference to "${refTab}": "${key}" not found.`);
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePendingRefs(v, indexes));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolvePendingRefs(v, indexes);
    }
    return out;
  }
  return value;
}

/**
 * Worker half of the restore flow: waits for the pre-restore snapshot
 * (`RestoreService.request`, #607), then re-validates the originally
 * uploaded workbook (the #693 seam) and applies it tab by tab, one DB
 * transaction per tab, in `ALL_TABS` order.
 *
 * Deliberately one transaction *per tab*, not one for the whole restore:
 * D8 says an error partway through must leave earlier tabs' writes
 * committed, because the safety net for a bad restore is the snapshot
 * taken before it started, not a giant rollback.
 */
@Processor(WORKBOOK_RESTORE_QUEUE, { concurrency: 1 })
export class RestoreProcessor extends WorkerHost {
  private readonly logger = new Logger(RestoreProcessor.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly staging: ImportStagingService,
    private readonly validationService: ValidationService,
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
    private readonly events: WorkbookJobEventsService,
    private readonly restoreService: RestoreService,
  ) {
    super();
  }

  async process(job: Job<RestoreJobData>): Promise<void> {
    const { jobId, inviteUsers } = job.data;

    const row = await this.jobs.findOne({ where: { id: jobId } });
    if (!row) {
      this.logger.warn(`RestoreProcessor: job row ${jobId} not found.`);
      return;
    }
    if (row.status === WorkbookJobStatus.DONE || row.status === WorkbookJobStatus.FAILED) {
      // Idempotent replay — a stalled-job recovery or a redelivered event
      // must not re-apply an already-terminal restore.
      return;
    }

    const tenantId = row.tenant_id;
    let currentTab: string | null = null;
    const rowCounts: WorkbookRowCounts = {};
    const createdUserIds: string[] = [];

    // Everything from here on lives inside the try: the per-tenant restore
    // lock is released only by `terminate` (or the success path), so any
    // throw that escapes `process()` — a DB blip on the RUNNING update, or
    // on one of the snapshot poll reads, which run for up to ten minutes —
    // would strand the lock until its TTL and leave the job row stuck at
    // RUNNING forever, with no FAILED status, no audit row and no email.
    try {
      await this.jobs.update(row.id, { status: WorkbookJobStatus.RUNNING, progress: null });

      const snapshotOk = await this.waitForSnapshot(row);
      if (!snapshotOk) {
        await this.terminate(row, tenantId, {
          status: WorkbookJobStatus.FAILED,
          error: 'SNAPSHOT_FAILED',
          failedTab: null,
        });
        return;
      }

      if (!row.staging_id) {
        throw new Error('Restore job has no staging_id.');
      }
      const staged = await this.staging.consume<StagedValidation>(
        tenantId,
        row.requested_by_user_id ?? '',
        row.staging_id,
      );
      if (!staged) {
        throw new Error('Staged import not found or already consumed.');
      }

      const stored = await this.storage.get(staged.workbook_storage_key);
      const chunks: Buffer[] = [];
      for await (const chunk of stored.body) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      // Re-validate fresh rather than trusting the staged preview: the
      // preview is only a summary (StagedValidation), never the typed rows
      // — see its own doc comment. This also guarantees the destination
      // data used to resolve natural-key refs is the tenant's *current*
      // state, not whatever it was at preview time.
      const validated = await this.validationService.validate(
        buffer,
        tenantId,
        this.dataSource.manager,
      );

      if (validated.hardErrorCount > 0) {
        // A row that failed to re-parse is simply missing from `rows` — if
        // we proceeded, `deleteByAbsence` (true on 16/18 tabs, including
        // payments/invoices/student_fees/users) would read that absence as
        // "the user deleted this row" and delete it for real. Never apply a
        // partially-broken re-validation.
        throw new Error(
          `Re-validation found ${validated.hardErrorCount} error(s); aborting before any tab is touched.`,
        );
      }

      // Natural-key -> real id, one per tab, built up as tabs are applied so
      // a later tab (or a self-reference within the same tab) can resolve a
      // row created earlier in this same restore.
      const indexes = new Map<string, KeyIndex>();

      for (const tab of ALL_TABS) {
        const tabResult = validated.tabs[tab.name];
        if (!tabResult?.present) continue;
        currentTab = tab.name;

        await this.dataSource.transaction(async (m) => {
          const existingEntities = await tab.load(tenantId, m);
          const index = KeyIndex.fromEntities(tab, existingEntities);
          indexes.set(tab.name, index);

          const existingByKey = new Map<string, (typeof existingEntities)[number]>();
          for (const entity of existingEntities) {
            existingByKey.set(tab.keyOf(entity), entity);
          }
          const matchedIds = new Set<string>();

          let applied = 0;
          for (const rawRow of tabResult.rows) {
            // Replace any `pending:<tab>:<key>` placeholder left by
            // ValidationService with the real id, now that earlier tabs'
            // rows are actually persisted — see `resolvePendingRefs`.
            const typedRow = resolvePendingRefs(rawRow, indexes) as never;
            const key = tab.keyOf(typedRow);
            const existing = existingByKey.get(key) ?? null;
            const entity = await tab.upsert(typedRow, existing, tenantId, m);
            const entityId = (entity as { id: string }).id;
            // Index by the key we already computed from the validated row,
            // not `tab.keyOf(entity)` — several tabs derive their key from
            // relations (`classes.tab.ts`, `sections.tab.ts`, ...) that
            // `upsert()`'s returned entity does not have populated, so
            // re-deriving from the entity degrades the key and can collide
            // across unrelated rows.
            index.add(key, entityId);
            matchedIds.add(entityId);
            applied += 1;

            if (tab.name === 'users' && existing === null) {
              createdUserIds.push(entityId);
            }
          }

          if (tab.deleteByAbsence) {
            for (const entity of existingEntities) {
              const id = (entity as { id: string }).id;
              if (!matchedIds.has(id)) {
                await tab.remove(entity, m);
              }
            }
          }

          rowCounts[tab.name] = applied;
        });

        await this.writeProgress(row.id, {
          tab: tab.name,
          done: tabResult.rows.length,
          total: tabResult.rows.length,
        });
      }

      const finishedAt = new Date();
      await this.jobs.update(row.id, {
        status: WorkbookJobStatus.DONE,
        row_counts: rowCounts,
        finished_at: finishedAt,
        error: null,
        failed_tab: null,
      });

      await this.restoreService.release(tenantId, row.id).catch(() => undefined);

      await this.safeAudit({
        event: 'RESTORE_COMPLETED',
        job: row,
        tenantId,
        extra: { row_counts: rowCounts },
      });

      this.safeEmit({
        jobId: row.id,
        tenantId,
        kind: row.kind,
        source: row.source,
        status: WorkbookJobStatus.DONE,
        requestedByUserId: row.requested_by_user_id,
        storageKey: row.storage_key,
        sizeBytes: row.size_bytes,
        rowCounts,
        error: null,
      });

      if (inviteUsers) {
        for (const userId of createdUserIds) {
          try {
            await this.invitations.issueAndSend({
              userId,
              tenantId,
              actorUserId: row.requested_by_user_id,
            });
          } catch (err) {
            this.logger.warn(
              `RestoreProcessor: invite failed for user ${userId} created by restore ${row.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    } catch (err) {
      const message = this.mapError(err);
      await this.terminate(row, tenantId, {
        status: WorkbookJobStatus.FAILED,
        error: message,
        failedTab: currentTab,
      });
    }
  }

  /**
   * Polls the snapshot job every `SNAPSHOT_POLL_INTERVAL_MS` until it
   * reaches `DONE` (returns true), or `FAILED`/missing/timeout (returns
   * false). Never touches any tab while this is pending.
   */
  private async waitForSnapshot(row: WorkbookJob): Promise<boolean> {
    if (!row.snapshot_job_id) return false;

    const deadline = Date.now() + SNAPSHOT_MAX_WAIT_MS;
    for (;;) {
      const snapshot = await this.jobs.findOne({ where: { id: row.snapshot_job_id } });
      if (snapshot?.status === WorkbookJobStatus.DONE) return true;
      if (!snapshot || snapshot.status === WorkbookJobStatus.FAILED) return false;

      if (Date.now() >= deadline) return false;
      await sleep(SNAPSHOT_POLL_INTERVAL_MS);
    }
  }

  /** Postgres error mapping — reuses the ad hoc idiom used everywhere else
   * in this codebase (see `attendance.service.ts`, `bulk-upload.service.ts`,
   * `users.service.ts`) rather than a new shared helper. Some tabs
   * (`student-fees.tab.ts`, `payment-allocations.tab.ts`) already catch
   * `23503` themselves and rethrow a clearer plain `Error`, so this is not
   * always the first thing to see the raw driver error — that is fine,
   * `err.message` below already carries their clearer text. */
  private mapError(err: unknown): string {
    if (err instanceof QueryFailedError) {
      const code = (err as unknown as { code?: string }).code;
      const constraint = (err as unknown as { constraint?: string }).constraint;
      if (code === '23505') {
        return `already exists: ${constraint ?? 'unique constraint'}`;
      }
      if (code === '23503') {
        return 'referenced by another record';
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private async writeProgress(jobId: string, progress: WorkbookJobProgress): Promise<void> {
    try {
      await this.jobs.update(jobId, { progress });
    } catch (err) {
      // Progress is a UX nicety, not correctness — never let a progress
      // write failure abort or fail the restore.
      this.logger.warn(
        `RestoreProcessor: failed to write progress for job ${jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async terminate(
    row: WorkbookJob,
    tenantId: string,
    outcome: { status: WorkbookJobStatus.FAILED; error: string; failedTab: string | null },
  ): Promise<void> {
    try {
      await this.jobs.update(row.id, {
        status: outcome.status,
        error: outcome.error,
        failed_tab: outcome.failedTab,
        finished_at: new Date(),
      });
    } catch (updateErr) {
      this.logger.error(
        `RestoreProcessor: failed to write FAILED status for job ${row.id}: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`,
      );
    }

    await this.restoreService.release(tenantId, row.id).catch(() => undefined);

    await this.safeAudit({
      event: 'RESTORE_FAILED',
      job: row,
      tenantId,
      extra: { failed_tab: outcome.failedTab, error: outcome.error },
    });

    this.logger.error(
      `RestoreProcessor: restore job ${row.id} (tenant ${tenantId}) failed at "${
        outcome.failedTab ?? 'n/a'
      }": ${outcome.error}`,
    );
    Sentry.withScope((scope) => {
      scope.setTags({
        queue: WORKBOOK_RESTORE_QUEUE,
        workbook_job_id: row.id,
        tenant_id: tenantId,
      });
      Sentry.captureException(new Error(outcome.error));
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
      error: outcome.error,
    });
  }

  /** No dedicated RESTORE_* AuditAction exists yet (same interim stand-in
   * `RestoreService.request` and `ExportProcessor` already use): reuse
   * `AuditAction.CREATE` / entity_type `'School'`, with the real event name
   * carried in `new_values.event`. Wrapped defensively — an audit hiccup
   * must never turn an otherwise-correct outcome into a crash. */
  private async safeAudit(input: {
    event: 'RESTORE_COMPLETED' | 'RESTORE_FAILED';
    job: WorkbookJob;
    tenantId: string;
    extra: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.audit.record({
        action: AuditAction.CREATE,
        entity_type: 'School',
        entity_id: input.job.id,
        tenant_id: input.tenantId,
        performed_by_user_id: input.job.requested_by_user_id,
        new_values: {
          event: input.event,
          workbook_job_id: input.job.id,
          snapshot_job_id: input.job.snapshot_job_id,
          ...input.extra,
        },
      });
    } catch (err) {
      this.logger.error(
        `RestoreProcessor: audit write failed for job ${input.job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Never let a listener bug fail an otherwise-successful (or already
   * terminal) restore. */
  private safeEmit(payload: Parameters<WorkbookJobEventsService['emitFinished']>[0]): void {
    try {
      this.events.emitFinished(payload);
    } catch (err) {
      this.logger.error(
        `RestoreProcessor: WORKBOOK_JOB_FINISHED listener threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<RestoreJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error({
      msg: 'workbook restore job failed',
      queue: WORKBOOK_RESTORE_QUEUE,
      workbook_job_id: job.data.jobId,
      error: err?.message,
    });
  }
}
