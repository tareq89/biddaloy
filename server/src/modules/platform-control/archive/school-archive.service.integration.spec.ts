import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { ApprovalScope, AuditAction, ImpersonationEndedBy } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { SchoolsService } from '../../schools/schools.service';
import { ImpersonationSessionService } from '../../support-access/sessions/impersonation-session.service';
import { StorageService } from '../../storage/storage.service';
import { ExportService } from '../../workbook/export/export.service';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../../workbook/jobs/workbook-job.entity';
import { SchoolArchiveService } from './school-archive.service';

const context = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('SchoolArchiveService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let service: SchoolArchiveService;
  const sessions = { revokeAllForSchool: vi.fn().mockResolvedValue(0) };
  const storage = { get: vi.fn() };
  const exportsSvc = { run: vi.fn() };

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      SchoolArchiveService,
      AuditService,
      { provide: ImpersonationSessionService, useValue: sessions },
      { provide: StorageService, useValue: storage },
      { provide: ExportService, useValue: exportsSvc },
      {
        // The real updateStatus (audit, cache, reserved-reason guard) is covered by its own specs;
        // this stand-in writes the same two columns so the school really becomes SUSPENDED.
        provide: SchoolsService,
        useFactory: (d: DataSource) => ({
          updateStatus: async (id: string, dto: { status: string; reason: string }) =>
            d
              .getRepository(School)
              .update(id, { status: dto.status as never, status_reason: dto.reason }),
        }),
        inject: [DataSource],
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(SchoolArchiveService);
  });

  afterAll(async () => {
    await module?.close();
  });

  const sfx = () => randomUUID().slice(0, 8);
  const school = (s = sfx()) =>
    ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${s}`, slug: `s-${s}` }));
  const job = (tenantId: string, over: Partial<WorkbookJob> = {}) =>
    ds.getRepository(WorkbookJob).save(
      ds.getRepository(WorkbookJob).create({
        tenant_id: tenantId,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.DONE,
        storage_key: `k-${sfx()}`,
        size_bytes: '4',
        ...over,
      }),
    );
  const statusOf = async (id: string) => ds.getRepository(School).findOneByOrFail({ id });

  it('archive without a DONE export is 409 and the school stays ACTIVE', async () => {
    const a = await school();
    const running = await job(a.id, { status: WorkbookJobStatus.RUNNING, storage_key: null });
    await expect(
      service.archive(
        a.id,
        { exportJobId: running.id, reason: 'School closed' },
        randomUUID(),
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await statusOf(a.id)).status).toBe('ACTIVE');
  });

  it("archive with another school's job is 404", async () => {
    const a = await school();
    const b = await school();
    const bJob = await job(b.id);
    await expect(
      service.archive(
        a.id,
        { exportJobId: bJob.id, reason: 'School closed' },
        randomUUID(),
        context,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await statusOf(a.id)).status).toBe('ACTIVE');
  });

  it('archive with a DONE job suspends, pins the file, ends Login as and audits the job id', async () => {
    const a = await school();
    const done = await job(a.id);
    // audit_logs.performed_by_user_id is a real FK, so the actor must exist.
    const actor = (
      await ds
        .getRepository(User)
        .save(
          ds.getRepository(User).create({ full_name: 'Owner', email: `o-${sfx()}@example.com` }),
        )
    ).id;
    await service.archive(a.id, { exportJobId: done.id, reason: 'School closed' }, actor, context);

    const s = await statusOf(a.id);
    expect(s.status).toBe('SUSPENDED');
    expect(s.status_reason).toBe('Archived: School closed');
    expect((await ds.getRepository(WorkbookJob).findOneByOrFail({ id: done.id })).pinned).toBe(
      true,
    );
    expect(sessions.revokeAllForSchool).toHaveBeenCalledWith(a.id, ImpersonationEndedBy.OWNER);
    const [row] = await ds
      .getRepository(AuditLog)
      .find({ where: { entity_id: a.id, action: AuditAction.PLATFORM_SCHOOL_ARCHIVED } });
    expect(row.tenant_id).toBe(a.id);
    expect(row.new_values).toMatchObject({
      exportJobId: done.id,
      approval_scope: ApprovalScope.PLATFORM_SCHOOL_CONTROL,
    });

    // The export stays downloadable after the school is suspended.
    storage.get.mockResolvedValue({ body: 'stream' });
    await expect(service.download(a.id, done.id)).resolves.toMatchObject({ body: 'stream' });
  });

  it("school B's job cannot be read or downloaded through school A's path", async () => {
    const a = await school();
    const b = await school();
    const bJob = await job(b.id);
    await expect(service.getExport(a.id, bJob.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.download(a.id, bJob.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalledWith(bJob.storage_key);
  });

  it('startExport allows one running export per school', async () => {
    const a = await school();
    exportsSvc.run.mockImplementation(async (tenantId: string) =>
      job(tenantId, { status: WorkbookJobStatus.QUEUED, storage_key: null }),
    );
    await service.startExport(a.id);
    await expect(service.startExport(a.id)).rejects.toBeInstanceOf(ConflictException);
    expect(exportsSvc.run).toHaveBeenCalledTimes(1);
  });
});
