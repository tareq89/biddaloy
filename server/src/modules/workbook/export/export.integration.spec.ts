import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { ExportProcessor } from './export.processor';
import { readWorkbook } from '../codec/workbook-codec';
import { ALL_TABS } from '../codec/registry';
import { SCHEMA_VERSION } from '../codec/meta';
import { META_SHEET } from '../codec/meta';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../jobs/workbook-job.entity';
import type { WorkbookExportJobData } from './export.constants';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

/** In-memory stand-in for `StorageService` — no S3/MinIO needed. Captures
 * every `put` so the test can read the bytes back with `readWorkbook`. */
class FakeStorageService {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
}

function fakeJob(jobId: string, tenantId: string): Job<WorkbookExportJobData> {
  return {
    data: { jobId, tenantId },
    opts: { attempts: 2 },
    attemptsMade: 0,
  } as Job<WorkbookExportJobData>;
}

describe('ExportProcessor (integration)', () => {
  let dataSource: DataSource;
  let auditService: AuditService;
  let storage: FakeStorageService;
  let processor: ExportProcessor;

  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const SECRET = `super-secret-${randomUUID()}`;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    // Constructed directly, not via AuditModule: that module also wires a
    // global guard (ContextGuard/TenantStatusService) that needs the full
    // app graph to resolve, which this narrow processor test has no need
    // for — AuditService's only dependency is the AuditLog repository.
    auditService = new AuditService(dataSource.getRepository(AuditLog));

    await dataSource.getRepository(School).save([
      dataSource.getRepository(School).create({
        id: TENANT_A,
        name: 'Export Test School A',
        slug: `export-test-a-${TENANT_A.slice(0, 8)}`,
        // The `school` tab's `toRow` redacts known secret paths (see
        // `school.tab.ts`/`school.tab.spec.ts`) — planting the secret at
        // exactly that path and asserting it never appears in the workbook
        // bytes is this test's leak check.
        settings: { communications: { sms: { mimsms: { apiKey: SECRET } } } } as any,
      }),
      dataSource.getRepository(School).create({
        id: TENANT_B,
        name: 'Export Test School B',
        slug: `export-test-b-${TENANT_B.slice(0, 8)}`,
      }),
    ]);

    storage = new FakeStorageService();
    processor = new ExportProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      auditService,
      { emitFinished: vi.fn() } as any,
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(WorkbookJob).delete({ tenant_id: TENANT_A });
    await dataSource.getRepository(WorkbookJob).delete({ tenant_id: TENANT_B });
    await dataSource.getRepository(School).delete({ id: TENANT_A });
    await dataSource.getRepository(School).delete({ id: TENANT_B });
  });

  it("a seeded tenant's job reaches DONE and the stored workbook has every ALL_TABS sheet plus _meta", async () => {
    const jobRow = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_A,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );

    await processor.process(fakeJob(jobRow.id, TENANT_A));

    const finished = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: jobRow.id } });
    expect(finished.status).toBe(WorkbookJobStatus.DONE);
    expect(finished.storage_key).toBeTruthy();

    const buffer = storage.objects.get(finished.storage_key as string);
    expect(buffer).toBeTruthy();

    const result = await readWorkbook(buffer as Buffer);
    for (const tab of ALL_TABS) {
      expect(result.sheets.has(tab.name)).toBe(true);
    }
    expect(result.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(result.meta.source_school_name).toBe('Export Test School A');
    expect(result.meta.source_school_slug).toContain('export-test-a');

    // row_counts equals the DB counts for every currently-registered tab:
    // this test doesn't seed any per-tab domain rows, so every tab is 0
    // except `school` itself (exactly one row: the tenant's own School).
    for (const tab of ALL_TABS) {
      const expected = tab.name === 'school' ? 1 : 0;
      expect(finished.row_counts?.[tab.name]).toBe(expected);
    }

    // The workbook bytes never contain the tenant's secret settings value —
    // the `school` tab redacts known secret paths before export.
    expect(buffer!.toString('latin1')).not.toContain(SECRET);
  });

  it("tenant isolation: a job row for tenant B is not visible to a process() call for tenant A", async () => {
    const jobForB = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_B,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );

    // Same job id, wrong tenant in the job payload — must resolve to "not
    // found", not tenant B's row.
    await processor.process(fakeJob(jobForB.id, TENANT_A));

    const untouched = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: jobForB.id } });
    expect(untouched.status).toBe(WorkbookJobStatus.QUEUED);
  });

  it('the meta sheet name matches META_SHEET', async () => {
    // Sanity check that the codec's own constant is what this test's
    // sheet-presence assertions rely on.
    expect(META_SHEET).toBe('_meta');
  });
});
