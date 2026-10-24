import { randomUUID } from 'crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { User } from '../../modules/users/entities/user.entity';
import { Class } from '../../modules/academics/entities/class.entity';
import { ClassSection } from '../../modules/academics/entities/class-section.entity';
import { Student } from '../../modules/students/entities/student.entity';
import { FeeStructure } from '../../modules/fees/entities/fee-structure.entity';
import { ImportStagingService } from '../../modules/bulk-import/import-staging.service';
import { ValidationService } from '../../modules/workbook/import/validation.service';
import { RestoreProcessor } from '../../modules/workbook/restore/restore.processor';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../../modules/workbook/jobs/workbook-job.entity';
import { branchCounts, SCENARIOS } from './scenarios';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

// Same in-memory stand-ins restore.integration.spec.ts uses: no S3 or Redis needed.
class FakeStorageService {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    const body = this.objects.get(key);
    if (!body) throw new Error(`no object at "${key}"`);
    return { body: Readable.from([body]) };
  }
}
class FakeRedis {
  private readonly store = new Map<string, string>();
  async set(key: string, value: string) {
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async getdel(key: string) {
    const v = this.store.get(key) ?? null;
    this.store.delete(key);
    return v;
  }
}

const GUIDE_ROOT = resolve(__dirname, '../../../../docs/user-guide');
const fileFor = (lang: string, name: string) =>
  `${GUIDE_ROOT}/${lang}/admin-setup/scenarios/files/${name}.xlsx`;

describe('guide scenario workbooks (round trip through the real restore)', () => {
  let dataSource: DataSource;
  let storage: FakeStorageService;
  let staging: ImportStagingService;
  let processor: RestoreProcessor;
  const USER_ID = randomUUID();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    storage = new FakeStorageService();
    staging = new ImportStagingService(new FakeRedis() as any);
    processor = new RestoreProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      staging,
      new ValidationService(),
      { issueAndSend: vi.fn() } as any,
      new AuditService(dataSource.getRepository(AuditLog)),
      { emitFinished: vi.fn() } as any,
      {
        release: vi.fn().mockResolvedValue(undefined),
        renewLock: vi.fn().mockResolvedValue(true),
      } as any,
      { isActive: vi.fn().mockResolvedValue(true) } as any,
    );
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: USER_ID,
        email: `guide-scenarios-${USER_ID.slice(0, 8)}@test.com`,
        full_name: 'Guide Scenarios Admin',
      }),
    );
  });

  async function restoreInto(tenantId: string, buffer: Buffer): Promise<WorkbookJob> {
    const key = `staging/${randomUUID()}.xlsx`;
    await storage.put(key, buffer);
    const { stagingId } = await staging.stage(tenantId, USER_ID, {
      workbook_storage_key: key,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: true,
      errors: [],
      warnings: [],
    });
    const jobs = dataSource.getRepository(WorkbookJob);
    const snapshot = await jobs.save(
      jobs.create({
        tenant_id: tenantId,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.DONE,
        requested_by_user_id: USER_ID,
      }),
    );
    const job = await jobs.save(
      jobs.create({
        tenant_id: tenantId,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: USER_ID,
        staging_id: stagingId,
        snapshot_job_id: snapshot.id,
      }),
    );
    await processor.process({ data: { jobId: job.id, inviteUsers: false } } as any);
    return jobs.findOneOrFail({ where: { id: job.id } });
  }

  const cases = SCENARIOS.flatMap((s) => s.branches.map((b) => [b.file, b] as const));

  it('covers 5 scenarios in 7 files', () => {
    expect(SCENARIOS).toHaveLength(5);
    expect(cases).toHaveLength(7);
  });

  it.each(cases)(
    '%s.xlsx imports into a fresh school with the scenario counts',
    async (_file, branch) => {
      const path = fileFor('en', branch.file);
      expect(statSync(path).size).toBeLessThan(200 * 1024);
      const buffer = readFileSync(path);
      // bn and en carry the same file (the codec headers are language-neutral).
      expect(readFileSync(fileFor('bn', branch.file)).equals(buffer)).toBe(true);

      const tenantId = randomUUID();
      await dataSource.getRepository(School).save(
        dataSource.getRepository(School).create({
          id: tenantId,
          name: `Guide ${branch.file}`,
          slug: `guide-${tenantId.slice(0, 8)}`,
        }),
      );

      const job = await restoreInto(tenantId, buffer);
      expect(job.error).toBeNull();
      expect(job.status).toBe(WorkbookJobStatus.DONE);

      const want = branchCounts(branch);
      const count = (e: any) =>
        dataSource.getRepository(e).count({ where: { tenant_id: tenantId } });
      expect({
        classes: await count(Class),
        sections: await count(ClassSection),
        students: await count(Student),
        feeStructures: await count(FeeStructure),
      }).toEqual(want);
    },
    60_000,
  );
});
