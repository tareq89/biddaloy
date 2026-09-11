import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, QueryFailedError } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../../schools/entities/school.entity';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobStatus,
  WorkbookJobSource,
} from './workbook-job.entity';

/**
 * Integration tests for the [14.2.2] WorkbookJob entity — run against the
 * real, migrated test database (not `{ synchronize: true, dropSchema: true }`
 * — see `server/CLAUDE.md`'s note on why: the migration's raw-SQL enum
 * types and FK constraints are migration-only objects a `dropSchema`
 * connection would silently rebuild without, so this suite would pass for
 * the wrong reason).
 */
describe('WorkbookJob entity (integration)', () => {
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM workbook_jobs');
  });

  function repo() {
    return dataSource.getRepository(WorkbookJob);
  }

  it('inserts and reads a job', async () => {
    const saved = await repo().save({ tenant_id: TENANT_ID, kind: WorkbookJobKind.EXPORT });
    const found = await repo().findOne({ where: { id: saved.id } });
    expect(found?.kind).toBe(WorkbookJobKind.EXPORT);
  });

  it('defaults status to QUEUED, source to MANUAL and pinned to false', async () => {
    const saved = await repo().save({ tenant_id: TENANT_ID, kind: WorkbookJobKind.EXPORT });
    const found = await repo().findOne({ where: { id: saved.id } });
    expect(found?.status).toBe(WorkbookJobStatus.QUEUED);
    expect(found?.source).toBe(WorkbookJobSource.MANUAL);
    expect(found?.pinned).toBe(false);
  });

  it('leaves every optional column null on a fresh job', async () => {
    const saved = await repo().save({ tenant_id: TENANT_ID, kind: WorkbookJobKind.EXPORT });
    const found = await repo().findOne({ where: { id: saved.id } });
    expect(found?.storage_key).toBeNull();
    expect(found?.size_bytes).toBeNull();
    expect(found?.row_counts).toBeNull();
    expect(found?.progress).toBeNull();
    expect(found?.staging_id).toBeNull();
    expect(found?.snapshot_job_id).toBeNull();
    expect(found?.failed_tab).toBeNull();
    expect(found?.error).toBeNull();
    expect(found?.expires_at).toBeNull();
    expect(found?.finished_at).toBeNull();
    expect(found?.requested_by_user_id).toBeNull();
    expect(found?.created_at).toBeInstanceOf(Date);
  });

  it('does not let tenant A read tenant B job through a tenant-scoped query', async () => {
    const saved = await repo().save({ tenant_id: OTHER_TENANT, kind: WorkbookJobKind.EXPORT });
    const found = await repo().findOne({ where: { id: saved.id, tenant_id: TENANT_ID } });
    expect(found).toBeNull();

    const listForTenantA = await repo().find({ where: { tenant_id: TENANT_ID } });
    expect(listForTenantA).toHaveLength(0);
  });

  it('rejects a job whose tenant does not exist', async () => {
    await expect(
      repo().save({
        tenant_id: '00000000-0000-4000-8000-0000000000ff',
        kind: WorkbookJobKind.EXPORT,
      }),
    ).rejects.toThrow(QueryFailedError);
  });

  it('returns size_bytes as a string, not a number', async () => {
    const saved = await repo().save({
      tenant_id: TENANT_ID,
      kind: WorkbookJobKind.EXPORT,
      size_bytes: '9007199254740993',
    });
    const found = await repo().findOne({ where: { id: saved.id } });
    expect(typeof found?.size_bytes).toBe('string');
    expect(found?.size_bytes).toBe('9007199254740993');
  });

  it('round-trips row_counts and progress jsonb', async () => {
    const saved = await repo().save({
      tenant_id: TENANT_ID,
      kind: WorkbookJobKind.EXPORT,
      row_counts: { students: 412, guardians: 388 },
      progress: { tab: 'students', done: 100, total: 412 },
    });
    const found = await repo().findOne({ where: { id: saved.id } });
    expect(found?.row_counts).toEqual({ students: 412, guardians: 388 });
    expect(found?.progress).toEqual({ tab: 'students', done: 100, total: 412 });
  });

  it('stores every kind enum value', async () => {
    for (const kind of Object.values(WorkbookJobKind)) {
      const saved = await repo().save({ tenant_id: TENANT_ID, kind });
      const found = await repo().findOne({ where: { id: saved.id } });
      expect(found?.kind).toBe(kind);
    }
  });

  it('stores every status enum value', async () => {
    for (const status of Object.values(WorkbookJobStatus)) {
      const saved = await repo().save({
        tenant_id: TENANT_ID,
        kind: WorkbookJobKind.EXPORT,
        status,
      });
      const found = await repo().findOne({ where: { id: saved.id } });
      expect(found?.status).toBe(status);
    }
  });

  it('stores every source enum value', async () => {
    for (const source of Object.values(WorkbookJobSource)) {
      const saved = await repo().save({
        tenant_id: TENANT_ID,
        kind: WorkbookJobKind.EXPORT,
        source,
      });
      const found = await repo().findOne({ where: { id: saved.id } });
      expect(found?.source).toBe(source);
    }
  });

  it('was created by the migration, not by entity sync', async () => {
    const rows = await dataSource.query(
      `SELECT 1 FROM typeorm_migrations WHERE name = 'AddWorkbookJobs1789500000000'`,
    );
    expect(rows).toHaveLength(1);
  });
});
