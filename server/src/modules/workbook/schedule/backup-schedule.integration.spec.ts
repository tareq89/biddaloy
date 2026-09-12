import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { WorkbookJob, WorkbookJobStatus } from '../jobs/workbook-job.entity';
import { ExportService } from '../export/export.service';
import { WORKBOOK_EXPORT_QUEUE } from '../export/export.constants';
import { BackupScheduleService } from './backup-schedule.service';
import { schedulerIdFor } from './backup-schedule.constants';
import { resolveTenantSettings } from '../../schools/settings/tenant-settings-resolver';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** Same-shaped subset of `SchoolsService` this module actually calls — a
 * full `SchoolsService` drags in Redis tenant-status caching and field
 * encryption that this test has no need to exercise. Backed by the real
 * `schools` table so status/settings reads are genuine. */
class FakeSchoolsService {
  constructor(private readonly repo: ReturnType<DataSource['getRepository']>) {}

  async findById(id: string) {
    return this.repo.findOneOrFail({ where: { id } });
  }

  async findAll() {
    return this.repo.find({ select: ['id', 'name', 'slug', 'status', 'created_at'] });
  }

  async getResolvedSettings(id: string) {
    const school = await this.findById(id);
    return resolveTenantSettings((school as any).settings ?? null);
  }
}

describe('BackupScheduleService (integration, real Redis + DB)', () => {
  let dataSource: DataSource;
  let scheduleQueue: Queue;
  let exportQueue: Queue;
  let service: BackupScheduleService;
  let schoolRepo: ReturnType<DataSource['getRepository']>;

  const TENANT = randomUUID();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = dataSource.getRepository(School);

    await schoolRepo.save(
      schoolRepo.create({
        id: TENANT,
        name: 'Backup Schedule Test School',
        slug: `backup-sched-${TENANT.slice(0, 8)}`,
        status: 'ACTIVE',
        settings: { backup: { schedule: 'WEEKLY' }, region: { timezone: 'Asia/Dhaka' } } as any,
      }),
    );

    scheduleQueue = new Queue('workbook-backup-schedule-test-' + TENANT, {
      connection: { url: REDIS_URL } as any,
    });
    exportQueue = new Queue(WORKBOOK_EXPORT_QUEUE, { connection: { url: REDIS_URL } as any });

    const auditService = new AuditService(dataSource.getRepository(AuditLog));
    const exportService = new ExportService(
      dataSource.getRepository(WorkbookJob),
      exportQueue as any,
      auditService,
    );

    service = new BackupScheduleService(
      scheduleQueue as any,
      new FakeSchoolsService(schoolRepo) as any,
      exportService,
    );
  });

  afterEach(async () => {
    const schedulers = await scheduleQueue.getJobSchedulers();
    for (const s of schedulers) {
      await scheduleQueue.removeJobScheduler(s.key as string);
    }
  });

  afterAll(async () => {
    // `audit_logs` is append-only (a DB trigger blocks UPDATE/DELETE — see
    // its migration), and `ExportService.run` (exercised by `runNow` below)
    // writes one there. That row's FK to `schools` means this tenant's
    // `School` row can never be deleted once `runNow` has run against it.
    // The whole test database is dropped and re-migrated per `vitest run`
    // invocation (`test/global-setup.ts`), so this is not a real leak —
    // just don't attempt the delete.
    // `runNow` enqueued onto the SHARED `WORKBOOK_EXPORT_QUEUE`. Remove
    // this tenant's leftover jobs before dropping their rows — closing the
    // connection alone leaves them in Redis for `ExportProcessor` to pick
    // up with no matching row. Scoped to this tenant, not `drain()`: the
    // queue is shared with every other suite on the same Redis.
    const leftover = await exportQueue.getJobs(['waiting', 'delayed', 'prioritized']);
    for (const job of leftover) {
      if (job.data?.tenantId === TENANT) await job.remove();
    }
    await dataSource.getRepository(WorkbookJob).delete({ tenant_id: TENANT });
    await scheduleQueue.obliterate({ force: true });
    await scheduleQueue.close();
    await exportQueue.close();
  });

  it('sync twice for the same tenant leaves exactly one scheduler entry', async () => {
    await service.sync(TENANT);
    await service.sync(TENANT);

    const schedulers = await scheduleQueue.getJobSchedulers();
    expect(schedulers.filter((s) => s.key === schedulerIdFor(TENANT))).toHaveLength(1);
  });

  it('a fresh service instance against the same Redis still sees the one scheduler after a restart', async () => {
    await service.sync(TENANT);

    const freshQueue = new Queue(scheduleQueue.name, { connection: { url: REDIS_URL } as any });
    try {
      const schedulers = await freshQueue.getJobSchedulers();
      expect(schedulers.filter((s) => s.key === schedulerIdFor(TENANT))).toHaveLength(1);
    } finally {
      await freshQueue.close();
    }
  });

  it('sync to WEEKLY then OFF leaves zero schedulers for that tenant (id round-trips through removeJobScheduler)', async () => {
    await service.sync(TENANT);
    let schedulers = await scheduleQueue.getJobSchedulers();
    expect(schedulers.filter((s) => s.key === schedulerIdFor(TENANT))).toHaveLength(1);

    await schoolRepo.update(TENANT, {
      settings: { backup: { schedule: 'OFF' }, region: { timezone: 'Asia/Dhaka' } } as any,
    });
    await service.sync(TENANT);

    schedulers = await scheduleQueue.getJobSchedulers();
    expect(schedulers.filter((s) => s.key === schedulerIdFor(TENANT))).toHaveLength(0);

    // restore for subsequent tests
    await schoolRepo.update(TENANT, {
      settings: { backup: { schedule: 'WEEKLY' }, region: { timezone: 'Asia/Dhaka' } } as any,
    });
  });

  it('runNow creates a workbook_jobs row (source SCHEDULED, no requester) and enqueues it on workbook-export', async () => {
    await service.runNow(TENANT);

    const job = await dataSource.getRepository(WorkbookJob).findOne({
      where: { tenant_id: TENANT },
      order: { created_at: 'DESC' },
    });
    expect(job).toBeTruthy();
    expect(job!.source).toBe('SCHEDULED');
    expect(job!.requested_by_user_id).toBeNull();
    expect(job!.status).toBe(WorkbookJobStatus.QUEUED);

    // This is the assertion that would have caught the original break
    // (plan correction C1): the tick must land a job whose data.jobId
    // equals the row it just created, on the export queue's real
    // processor-visible shape.
    const waiting = await exportQueue.getJobs(
      ['waiting', 'delayed', 'active', 'completed', 'failed'],
      0,
      50,
    );
    const match = waiting.find((j) => j.data?.jobId === job!.id);
    expect(match).toBeTruthy();
    expect(match!.data.tenantId).toBe(TENANT);
  });
});
