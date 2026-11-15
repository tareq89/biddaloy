import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_TENANT_ID } from '@test/constants';
import { HomeworkBulkUploadService } from './homework-bulk-upload.service';
import { HomeworkAccessService } from './homework-access.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { Subject } from '../academics/entities/subject.entity';

/**
 * [#988] `commit()` is all-or-nothing: a DB failure on a later row rolls back
 * the homework and assignment rows already written for earlier rows, so a
 * retry cannot duplicate them (the staging id is consumed before the first write).
 */
describe('HomeworkBulkUploadService.commit rollback (integration)', () => {
  let service: HomeworkBulkUploadService;
  let ds: DataSource;
  let staged: unknown;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      HomeworkBulkUploadService,
      { provide: HomeworkAccessService, useValue: {} },
      { provide: ImportStagingService, useValue: { consume: async () => staged } },
    ]);
    service = module.get(HomeworkBulkUploadService);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  // The global per-test reset (test/setup.ts) clears subjects, so seed one per test.
  const seedSubject = async () =>
    (
      await ds.getRepository(Subject).save({
        tenant_id: SEED_TENANT_ID,
        name_en: 'Bulk rollback subject',
        code: 'BULKRB',
      })
    ).id;

  beforeEach(async () => {
    await ds.query(`DELETE FROM homework_assignments WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM homework WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  });

  const row = (n: number, rowSubjectId: string) => ({
    rowNumber: n,
    class: 'One',
    section: 'A',
    subject: 'Bulk',
    assigned_date: '2026-03-02',
    due_date: '2026-03-04',
    classId: SEED_CLASS_1_ID,
    sectionId: SEED_SECTION_1_ID,
    subjectId: rowSubjectId,
  });
  const counts = async () => [
    await ds.getRepository(Homework).count({ where: { tenant_id: SEED_TENANT_ID } }),
    await ds.getRepository(HomeworkAssignment).count({ where: { tenant_id: SEED_TENANT_ID } }),
  ];

  it('rolls back earlier rows when a later row fails', async () => {
    const subjectId = await seedSubject();
    // Row 3 points at a subject that does not exist: the FK fails mid-batch.
    staged = {
      filename: 'h.csv',
      hardErrorCount: 0,
      rows: [row(2, subjectId), row(3, subjectId), row(4, randomUUID())],
    };

    await expect(service.commit('s1', SEED_TENANT_ID, undefined)).rejects.toThrow();

    expect(await counts()).toEqual([0, 0]);
  });

  it('writes every row when the whole batch is valid', async () => {
    const subjectId = await seedSubject();
    staged = {
      filename: 'h.csv',
      hardErrorCount: 0,
      rows: [row(2, subjectId), row(3, subjectId)],
    };

    const result = await service.commit('s2', SEED_TENANT_ID, undefined);

    expect(result.success_count).toBe(2);
    expect(await counts()).toEqual([2, 2]);
  });
});
