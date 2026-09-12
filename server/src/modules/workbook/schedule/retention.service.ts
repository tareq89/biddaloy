import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';

/** How many of the newest SCHEDULED DONE exports survive retention, per D10. */
export const KEEP_SCHEDULED_COUNT = 8;

/** How many of the newest MANUAL DONE exports survive retention, per D10. */
export const KEEP_MANUAL_COUNT = 3;

/** A SNAPSHOT older than this is prunable regardless of count, per D10. */
export const SNAPSHOT_RETENTION_DAYS = 30;

/** Per-tenant cap on the total size of DONE, still-stored objects. Once a
 * tenant is over this, the oldest unpinned DONE row is pruned repeatedly
 * until back under it. */
export const STORAGE_CAP_BYTES = 500 * 1024 * 1024;

/** See `recordDeletion` — how hard to try before a BACKUP_DELETED audit
 * row is given up on. */
export const AUDIT_WRITE_ATTEMPTS = 3;
export const AUDIT_WRITE_RETRY_MS = 200;

/**
 * [14.12.2] Retention, pinning and the per-tenant storage cap.
 *
 * Called once per tenant at the end of every successful export
 * (`ExportProcessor`) — never on a schedule of its own, so a tenant that
 * never exports never gets swept, which is fine: there is nothing to prune.
 *
 * Deletion is `StorageService.delete(key)` then the row is moved to
 * DELETED with `storage_key` cleared and `size_bytes` kept for history —
 * never a hard delete of the row. A `pinned` row is never touched by any
 * of the three passes below.
 *
 * Order of passes, each operating only on rows still DONE after the
 * previous pass:
 *   1. expired — `expires_at` in the past.
 *   2. per-category overflow — beyond the newest 8 SCHEDULED, the newest 3
 *      MANUAL, or a SNAPSHOT older than 30 days.
 *   3. storage cap — while the tenant's remaining DONE bytes exceed
 *      `STORAGE_CAP_BYTES`, delete the globally oldest unpinned DONE row.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** `now` is injectable for tests (fake clock) — production callers omit it. */
  async enforce(tenantId: string, now: Date = new Date()): Promise<void> {
    await this.pruneExpired(tenantId, now);
    await this.pruneCategoryOverflow(tenantId, now);
    await this.pruneOverCap(tenantId);
  }

  private async pruneExpired(tenantId: string, now: Date): Promise<void> {
    const rows = await this.jobs.find({
      where: { tenant_id: tenantId, status: WorkbookJobStatus.DONE, pinned: false },
    });
    for (const row of rows) {
      if (row.expires_at !== null && row.expires_at.getTime() <= now.getTime()) {
        await this.deleteRow(row);
      }
    }
  }

  private async pruneCategoryOverflow(tenantId: string, now: Date): Promise<void> {
    // D10: "Keep: every pinned row" is unconditional, separate from the
    // numeric SCHEDULED/MANUAL caps below — pinning is how an admin opts a
    // specific backup out of the count-based quota entirely, so a pinned
    // row does not occupy (and is excluded from) the 8/3 slice here. It
    // still counts against the byte-based storage cap in pruneOverCap,
    // where it is explicitly never evicted either.
    const rows = await this.jobs.find({
      where: { tenant_id: tenantId, status: WorkbookJobStatus.DONE, pinned: false },
      order: { created_at: 'DESC' },
    });

    const scheduled = rows.filter(
      (r) => r.source === WorkbookJobSource.SCHEDULED && r.kind === WorkbookJobKind.EXPORT,
    );
    for (const row of scheduled.slice(KEEP_SCHEDULED_COUNT)) {
      await this.deleteRow(row);
    }

    // Only EXPORT rows count against the MANUAL quota — a RESTORE job is
    // history, not a backup artefact competing for the same 3 slots, so a
    // recent restore must not evict (or itself be evicted as) a manual
    // export.
    const manual = rows.filter(
      (r) => r.source === WorkbookJobSource.MANUAL && r.kind === WorkbookJobKind.EXPORT,
    );
    for (const row of manual.slice(KEEP_MANUAL_COUNT)) {
      await this.deleteRow(row);
    }

    const snapshotCutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const snapshots = rows.filter((r) => r.kind === WorkbookJobKind.SNAPSHOT);
    for (const row of snapshots) {
      if (row.created_at.getTime() < snapshotCutoff.getTime()) {
        await this.deleteRow(row);
      }
    }
  }

  private async pruneOverCap(tenantId: string): Promise<void> {
    // Total is over every still-DONE row (pinned included — a pinned row
    // still occupies storage and counts against the cap even though it can
    // never itself be evicted to relieve it).
    let rows = await this.jobs.find({
      where: { tenant_id: tenantId, status: WorkbookJobStatus.DONE },
      order: { created_at: 'ASC' },
    });

    let total = rows.reduce((sum, r) => sum + Number(r.size_bytes ?? 0), 0);

    for (const row of rows) {
      if (total <= STORAGE_CAP_BYTES) break;
      if (row.pinned) continue;
      const deleted = await this.deleteRow(row);
      // Only count bytes actually freed — a storage-delete failure leaves
      // the row (and its bytes) in place, so the running total must not
      // drop as if they were reclaimed (that would let the sweep "succeed"
      // while the tenant stays over cap).
      if (deleted) total -= Number(row.size_bytes ?? 0);
    }
  }

  /** Returns whether the row was actually deleted (claim + storage delete +
   * status flip). A storage-side failure returns `false` and puts the row
   * back to DONE so the next `enforce()` retries it.
   *
   * The claim is the whole point: `PATCH /backup/jobs/:id/pin` and this
   * sweep both start from a snapshot read, so without it the two can
   * interleave as "sweep reads unpinned -> user pins, 200 OK -> sweep
   * deletes storage" and the user is told a backup is safe that is gone.
   * Flipping to DELETED with `status = DONE AND pinned = false` as the
   * predicate makes the row the single source of truth: whichever of the
   * two conditional updates lands second matches zero rows and backs off
   * (`pin()` answers 410 in that case). */
  private async deleteRow(row: WorkbookJob): Promise<boolean> {
    const claim = await this.jobs.update(
      { id: row.id, status: WorkbookJobStatus.DONE, pinned: false },
      { status: WorkbookJobStatus.DELETED },
    );
    if (!claim.affected) {
      // Pinned (or otherwise changed) since this pass loaded it.
      return false;
    }

    if (row.storage_key) {
      try {
        await this.storage.delete(row.storage_key);
      } catch (err) {
        // Never let a storage-side failure abort the sweep — release the
        // claim so the next enforce() call picks the row up again.
        this.logger.error(
          `RetentionService: storage delete failed for job ${row.id} (tenant ${row.tenant_id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.jobs.update(
          { id: row.id, status: WorkbookJobStatus.DELETED },
          { status: WorkbookJobStatus.DONE },
        );
        return false;
      }
    }

    await this.jobs.update(row.id, { storage_key: null });
    await this.recordDeletion(row);
    return true;
  }

  /** The BACKUP_DELETED audit row is the only durable record that retention
   * (not a person) removed a backup, and by the time it is written the row
   * is already DELETED — so a later sweep will never revisit it. A single
   * transient failure must therefore not lose it: retry with a short
   * backoff before giving up loudly. */
  private async recordDeletion(row: WorkbookJob): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= AUDIT_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await this.audit.record({
          action: AuditAction.BACKUP_DELETED,
          entity_type: 'School',
          entity_id: row.id,
          tenant_id: row.tenant_id,
          performed_by_user_id: null,
          new_values: {
            event: 'BACKUP_DELETED',
            workbook_job_id: row.id,
            kind: row.kind,
            source: row.source,
            size_bytes: row.size_bytes,
          },
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < AUDIT_WRITE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, AUDIT_WRITE_RETRY_MS * attempt));
        }
      }
    }
    this.logger.error(
      `RetentionService: audit write failed for job ${row.id} after ${AUDIT_WRITE_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
