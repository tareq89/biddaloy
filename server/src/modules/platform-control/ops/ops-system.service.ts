import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { HealthService } from '../../health/health.service';
import { BULK_IMPORT_REDIS } from '../../bulk-import/import-staging.service';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { release } from '../../workbook/restore/restore-lock';
import { RESTORE_LOCK_TTL_SEC } from '../../workbook/restore/restore.constants';
import type {
  OpsReleaseLockResponseDto,
  OpsRestoringSchoolDto,
  OpsSystemResponseDto,
} from './dto/ops-system.dto';

/** The worker renews every 5 min; a lock fresher than this (TTL left) has a live holder. */
export const LIVE_LOCK_MIN_TTL_SEC = RESTORE_LOCK_TTL_SEC - 600;
const PROBE_TIMEOUT_MS = 2000;
export const RELEASED_BY_OWNER = 'RELEASED_BY_OWNER';

// ponytail: restore-lock.ts does not export lockKey. Kept in step by the integration spec
// (acquire() then ttl through this key); export it there and delete this when #3816 allows.
export const restoreLockKey = (tenantId: string): string => `workbook:restore-lock:${tenantId}`;

interface JobRow {
  id: string;
  status: 'QUEUED' | 'RUNNING';
  progress: { tab?: string } | null;
  snapshot_job_id: string | null;
}

@Injectable()
export class OpsSystemService {
  private readonly logger = new Logger(OpsSystemService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BULK_IMPORT_REDIS) private readonly redis: Redis,
    private readonly health: HealthService,
    private readonly tenantStatus: TenantStatusService,
    private readonly audit: AuditService,
  ) {}

  private async probeDb(): Promise<'ok' | 'fail'> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), PROBE_TIMEOUT_MS);
        }),
      ]);
      return 'ok';
    } catch {
      return 'fail';
    } finally {
      clearTimeout(timer);
    }
  }

  private async lastMigration(): Promise<string | null> {
    try {
      const rows: Array<{ name: string }> = await this.dataSource.query(
        'SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 1',
      );
      return rows[0]?.name ?? null;
    } catch {
      return null;
    }
  }

  private async restoring(): Promise<OpsRestoringSchoolDto[]> {
    try {
      const rows: Array<{ tenant_id: string; name: string; status: 'QUEUED' | 'RUNNING' }> =
        await this.dataSource.query(
          `SELECT DISTINCT ON (j.tenant_id) j.tenant_id, s.name, j.status
             FROM workbook_jobs j JOIN schools s ON s.id = j.tenant_id
            WHERE j.kind = 'RESTORE' AND j.status IN ('QUEUED', 'RUNNING')
            ORDER BY j.tenant_id, j.created_at ASC
            LIMIT 100`,
        );
      return await Promise.all(
        rows.map(async (r) => ({
          schoolId: r.tenant_id,
          schoolName: r.name,
          jobStatus: r.status,
          locked: (await this.redis.exists(restoreLockKey(r.tenant_id))) === 1,
        })),
      );
    } catch (err) {
      this.logger.warn(`Restoring list failed: ${(err as Error).name}`);
      return [];
    }
  }

  async getSystem(): Promise<OpsSystemResponseDto> {
    const [database, redis, lastMigration, restoring] = await Promise.all([
      this.probeDb(),
      this.health.probeRedis(),
      this.lastMigration(),
      this.restoring(),
    ]);
    return {
      appVersion: process.env.APP_VERSION ?? 'unknown',
      lastMigration,
      database,
      redis,
      restoring,
    };
  }

  /**
   * Order: (1) 404 / 409 checks, (2) one DB transaction fails the unfinished RESTORE jobs
   * AND writes the audit row, so no job is failed without a record and an audit failure
   * rolls the jobs back, (3) only then the Redis lock is released (compare-and-delete per
   * job id; blind DEL only for an orphan lock with no unfinished job), (4) cache invalidated.
   * If step 3 fails after commit the jobs are already FAILED and the owner just presses
   * again (the orphan-lock branch finishes it). Errors never echo the school id (Rule 23).
   * Redis down is a 503 from the route's `@FailClosedWithoutRedis()`.
   */
  async releaseRestoreLock(
    schoolId: string,
    approverId: string,
  ): Promise<OpsReleaseLockResponseDto> {
    const known = await this.dataSource.query('SELECT 1 FROM schools WHERE id = $1', [schoolId]);
    if (known.length === 0) throw new NotFoundException('School not found.');

    const ttl = await this.redis.ttl(restoreLockKey(schoolId));
    if (ttl > LIVE_LOCK_MIN_TTL_SEC) {
      throw new ConflictException({
        code: 'RESTORE_RUNNING',
        message: 'A restore is still running for this school.',
      });
    }

    const failed = await this.dataSource.transaction(async (m) => {
      const jobs: JobRow[] = await m.query(
        `SELECT id, status, progress, snapshot_job_id FROM workbook_jobs
          WHERE tenant_id = $1 AND kind = 'RESTORE' AND status IN ('QUEUED', 'RUNNING')`,
        [schoolId],
      );
      const done: Array<{ job: JobRow; failedTab: string | null }> = [];
      for (const job of jobs) {
        const failedTab = job.progress?.tab ?? null;
        // Conditional: a worker that finished meanwhile is never overwritten.
        const res: [Array<{ id: string }>, number] = await m.query(
          `UPDATE workbook_jobs SET status = 'FAILED', error = $1, failed_tab = $2, finished_at = now()
            WHERE id = $3 AND status IN ('QUEUED', 'RUNNING') RETURNING id`,
          [RELEASED_BY_OWNER, failedTab, job.id],
        );
        if (res[0].length > 0) done.push({ job, failedTab });
      }
      await this.audit.recordApproved(
        {
          action: AuditAction.PLATFORM_RESTORE_LOCK_RELEASED,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: approverId,
          approved_by_user_id: approverId,
          approval_scope: ApprovalScope.PLATFORM_OPS_ACTION,
          new_values: {
            lock_ttl_sec: ttl,
            jobs: done.map(({ job, failedTab }) => ({
              workbook_job_id: job.id,
              previous_status: job.status,
              failed_tab: failedTab,
              snapshot_job_id: job.snapshot_job_id,
            })),
          },
        },
        m,
      );
      return { done, hadJobs: jobs.length > 0 };
    });

    for (const { job } of failed.done) await release(this.redis, schoolId, job.id);
    let orphanRemoved = false;
    if (!failed.hadJobs && ttl !== -2) {
      orphanRemoved = (await this.redis.del(restoreLockKey(schoolId))) > 0;
    }
    await this.tenantStatus.invalidate(schoolId);
    return {
      released: failed.done.length > 0 || orphanRemoved,
      failedJobs: failed.done.length,
    };
  }
}
